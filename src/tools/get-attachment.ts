import { z } from "zod";
import type { GitlabClient, ProjectId } from "../gitlab-client.js";
import { logTruncate } from "../util/log.js";
import { projectIdSchema } from "./shared.js";

export const getAttachmentInputShape = {
  url: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, {
      message: "url cannot be empty or whitespace-only",
    })
    .describe(
      "The upload link exactly as it appears in the issue / MR / comment markdown, e.g. '/uploads/e1f3b0a3a3022d8711a43ebcb93d4d49/screenshot.png'. Absolute URLs ('https://gitlab.example.com/group/repo/uploads/<secret>/<file>', '.../-/project/67/uploads/<secret>/<file>') and the whole markdown snippet ('![alt](/uploads/...){width=900}') are accepted too.",
    ),
  project_id: projectIdSchema
    .optional()
    .describe(
      "Project the issue / MR containing the link belongs to (the same project_id you passed to get_issue / get_merge_request). Required for relative '/uploads/...' links; optional when the url itself names the project. When given, it wins over the project in the url.",
    ),
  max_bytes: z
    .number()
    .int()
    .positive()
    .max(2_000_000)
    .optional()
    .describe(
      "TEXT attachments only: cap on bytes returned (default 200000). Longer text is truncated with a marker. Images and PDFs are never truncated — they are returned whole or not at all (5MB limit).",
    ),
} as const;

const inputSchema = z.object(getAttachmentInputShape);
export type GetAttachmentInput = z.infer<typeof inputSchema>;

export const getAttachmentTool = {
  name: "get_attachment",
  config: {
    title: "Read an image or file attached to a GitLab issue, MR, or comment",
    description: [
      "Download a file that someone pasted or uploaded into a GitLab issue, merge request, or comment (screenshots, mockups, logs, PDFs, CSVs, ...) and return it so you can actually look at it. READ-ONLY.",
      "",
      "GitLab stores these as markdown links like '![screenshot](/uploads/<32-hex-secret>/<filename>.png)' inside `description` and note `body` fields. get_issue / get_merge_request return those links but NOT the file contents — call this tool once per link you need to see.",
      "Use this when: the description or a comment contains an '/uploads/...' link and the user asks 'what does the screenshot show', 'look at the attached image', 'read the attached log/PDF', or the ticket can't be understood without the picture (e.g. 'see screenshot', 'like in the image').",
      "Do NOT use this for files in the git repository — use get_file_content. Do NOT use this for CI output — use get_job_log. Do NOT guess upload URLs; only pass links that appear in the markdown.",
      "",
      "Pass `url` as it appears in the markdown plus the `project_id` of the issue / MR it came from.",
      "",
      "Returns a JSON text block { filename, project_id, content_type, size_bytes, kind, ... } followed by:",
      "- kind='image' (PNG / JPEG / GIF / WebP, up to 5MB): an image content block you can see.",
      "- kind='text' (logs, CSV, JSON, SVG, ...): the content inline in the JSON as `content`, truncated at max_bytes (default 200000) with `truncated: true`.",
      "- kind='pdf' (up to 5MB): an embedded application/pdf resource; whether you can read it depends on the MCP client.",
      "- kind='binary' (archives, Office docs, oversized images/PDFs, ...): metadata only, with a `note` explaining why the content was not returned.",
      "",
      "Requires GitLab 17.4+ (the uploads-by-secret API endpoint). Older instances return 404.",
    ].join("\n"),
    inputSchema: getAttachmentInputShape,
  },
} as const;

/** Claude rejects images over 5MB; the same cap keeps PDFs from flooding context. */
const MAX_INLINE_BINARY_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TEXT_BYTES = 200_000;
const SCAN_BYTES = 8192;

const TRUNCATE_MARKER = (total: number, limit: number) =>
  `\n\n[... truncated, attachment is ${total} bytes total, requested max_bytes=${limit} ...]`;

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "resource";
      resource: { uri: string; mimeType: string; blob: string };
    };

export function makeGetAttachmentHandler(client: GitlabClient) {
  return async (args: GetAttachmentInput) => {
    const ref = parseUploadUrl(args.url);
    const projectId = args.project_id ?? ref.projectId;
    if (projectId === undefined) {
      throw new Error(
        `Cannot tell which project '${args.url}' belongs to. Relative '/uploads/...' links need project_id — pass the project_id of the issue or merge request the link appeared in.`,
      );
    }

    const { buffer, contentType } = await client.getProjectUploadRaw(
      projectId,
      ref.secret,
      ref.filename,
    );
    const size = buffer.byteLength;
    const meta = {
      filename: ref.filename,
      project_id: projectId,
      content_type: contentType,
      size_bytes: size,
    };
    const kind = classify(buffer, contentType, ref.filename);

    if (kind.type === "image" || kind.type === "pdf") {
      if (size > MAX_INLINE_BINARY_BYTES) {
        return result([
          json({
            ...meta,
            kind: "binary",
            note: `${kind.type === "image" ? "Image" : "PDF"} is ${size} bytes, over the ${MAX_INLINE_BINARY_BYTES}-byte inline limit — not returned. Ask the user to open it in GitLab.`,
          }),
        ]);
      }
      const data = buffer.toString("base64");
      if (kind.type === "image") {
        return result([
          json({ ...meta, kind: "image", mime_type: kind.mimeType }),
          { type: "image", data, mimeType: kind.mimeType },
        ]);
      }
      return result([
        json({ ...meta, kind: "pdf", mime_type: "application/pdf" }),
        {
          type: "resource",
          resource: {
            uri: `gitlab-upload://${projectId}/${ref.secret}/${encodeURIComponent(ref.filename)}`,
            mimeType: "application/pdf",
            blob: data,
          },
        },
      ]);
    }

    if (kind.type === "binary") {
      return result([
        json({
          ...meta,
          kind: "binary",
          note: "Binary attachment (not an image, PDF, or text file) — content not returned. Ask the user to open it in GitLab if its contents matter.",
        }),
      ]);
    }

    const maxBytes = args.max_bytes ?? DEFAULT_MAX_TEXT_BYTES;
    let content: string;
    let truncated = false;
    if (size > maxBytes) {
      truncated = true;
      content =
        buffer.subarray(0, maxBytes).toString("utf8") +
        TRUNCATE_MARKER(size, maxBytes);
      logTruncate({
        tool: "get_attachment",
        originalBytes: size,
        returnedBytes: maxBytes,
        limit: maxBytes,
        details: { filename: ref.filename },
      });
    } else {
      content = buffer.toString("utf8");
    }
    return result([json({ ...meta, kind: "text", content, truncated })]);
  };
}

function result(content: ToolContent[]) {
  return { content };
}

function json(value: unknown): ToolContent {
  return { type: "text", text: JSON.stringify(value, null, 2) };
}

export interface UploadRef {
  secret: string;
  filename: string;
  /** Project named by the url itself (`/-/project/<id>/` or `<host>/<path>/uploads/`). */
  projectId?: ProjectId;
}

const UPLOAD_RE = /\/uploads\/([0-9a-f]{32})\/([^\s)?#{}"'<>]+)/i;

/**
 * Pull secret + filename (and the project, when the url names one) out of
 * whatever the caller pasted: a bare `/uploads/...` path, an absolute web
 * URL, or the full `![alt](...){width=..}` markdown snippet.
 */
export function parseUploadUrl(input: string): UploadRef {
  const trimmed = input.trim();
  const m = trimmed.match(UPLOAD_RE);
  if (!m) {
    throw new Error(
      `'${input}' is not a GitLab upload link. Expected something like '/uploads/<32-hex-secret>/<filename>' as it appears in issue / MR markdown.`,
    );
  }
  const secret = m[1]!.toLowerCase();
  let filename: string;
  try {
    filename = decodeURIComponent(m[2]!);
  } catch {
    filename = m[2]!;
  }

  const before = trimmed.slice(0, m.index);
  const byId = before.match(/\/-\/project\/(\d+)$/);
  if (byId) return { secret, filename, projectId: Number(byId[1]) };
  if (/\/-\/group\/\d+$/.test(before)) {
    throw new Error(
      `'${input}' is a group-level upload (epic / group wiki). Only project uploads are supported.`,
    );
  }
  const byPath = before.match(/^(?:.*\()?https?:\/\/[^/]+\/(.+)$/);
  if (byPath) {
    let path = byPath[1]!;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep as-is
    }
    return { secret, filename, projectId: path };
  }
  return { secret, filename };
}

type Kind =
  | { type: "image"; mimeType: string }
  | { type: "pdf" }
  | { type: "text" }
  | { type: "binary" };

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Magic bytes first (GitLab sometimes serves uploads as
 * application/octet-stream), then Content-Type, then a null-byte scan.
 */
function classify(
  buffer: Buffer,
  contentType: string | null,
  filename: string,
): Kind {
  const sniffed = sniffMagic(buffer);
  if (sniffed) return sniffed;

  const ct = (contentType ?? "").toLowerCase().split(";")[0]!.trim();
  if (IMAGE_MIME_TYPES.has(ct)) return { type: "image", mimeType: ct };
  if (ct === "application/pdf") return { type: "pdf" };

  const scanLen = Math.min(buffer.byteLength, SCAN_BYTES);
  for (let i = 0; i < scanLen; i++) {
    if (buffer[i] === 0) return { type: "binary" };
  }
  // No null bytes: still refuse known-binary types that happen to start clean
  // (e.g. a tiny BMP header), but default to text — logs, CSV, JSON, SVG, ...
  if (
    (ct.startsWith("image/") && ct !== "image/svg+xml") ||
    ct.startsWith("video/") ||
    ct.startsWith("audio/") ||
    /\.(zip|gz|tgz|tar|rar|7z|docx?|xlsx?|pptx?|odt|ods|exe|dmg|bin|bmp|tiff?|heic|mp4|mov|mp3)$/i.test(
      filename,
    )
  ) {
    return { type: "binary" };
  }
  return { type: "text" };
}

function sniffMagic(b: Buffer): Kind | null {
  const startsWith = (bytes: number[], offset = 0) =>
    b.byteLength >= offset + bytes.length &&
    bytes.every((v, i) => b[offset + i] === v);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { type: "image", mimeType: "image/png" };
  }
  if (startsWith([0xff, 0xd8, 0xff])) {
    return { type: "image", mimeType: "image/jpeg" };
  }
  if (startsWith([0x47, 0x49, 0x46, 0x38])) {
    return { type: "image", mimeType: "image/gif" };
  }
  if (
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    startsWith([0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { type: "image", mimeType: "image/webp" };
  }
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return { type: "pdf" };
  return null;
}
