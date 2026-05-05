import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import { logTruncate } from "../util/log.js";
import { projectIdSchema } from "./shared.js";

export const getFileContentInputShape = {
  project_id: projectIdSchema,
  file_path: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, {
      message: "file_path cannot be empty or whitespace-only",
    })
    .describe(
      "Path within the repository, with forward slashes ('src/components/Button.tsx'). Do NOT URL-encode — the tool encodes for you.",
    ),
  ref: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Branch name, tag name, or commit SHA to read from. Defaults to 'HEAD' (the project's default branch).",
    ),
  max_bytes: z
    .number()
    .int()
    .positive()
    .max(2_000_000)
    .optional()
    .describe(
      "Hard cap on bytes returned (default 200000 = ~200KB). If the file is larger, the response is truncated at this byte count and a clearly marked notice is appended.",
    ),
} as const;

const inputSchema = z.object(getFileContentInputShape);
export type GetFileContentInput = z.infer<typeof inputSchema>;

export const getFileContentTool = {
  name: "get_file_content",
  config: {
    title: "Read a single file from a GitLab repository",
    description: [
      "Fetch the raw text content of a single file at a specific ref (branch / tag / commit SHA). READ-ONLY.",
      "",
      "Use this AFTER you know the path. If you don't, call list_repository_tree first to find it — searching by guessing paths wastes calls and produces 404s.",
      "Do NOT use this on binary files (images, PDFs, archives, compiled artifacts). The tool refuses with a clear error rather than returning garbage; binary detection runs against the first 8KB of bytes plus the response Content-Type.",
      "",
      "Identify the target with project_id (numeric id preferred, or 'group/repo' path) and file_path (forward-slashed, NOT URL-encoded).",
      "",
      "Truncation: when the file exceeds max_bytes (default 200000 ≈ 200KB), the response is sliced and a marker is appended. The `size_bytes` field always reflects the original file size, and `truncated` is set to true.",
      "",
      "Returns: { path, ref, size_bytes, content, truncated }.",
    ].join("\n"),
    inputSchema: getFileContentInputShape,
  },
} as const;

const TRUNCATE_MARKER = (total: number, limit: number) =>
  `\n\n[... truncated, file is ${total} bytes total, requested max_bytes=${limit} ...]`;

const SCAN_BYTES = 8192;

export function makeGetFileContentHandler(client: GitlabClient) {
  return async (args: GetFileContentInput) => {
    const ref = args.ref ?? "HEAD";
    const maxBytes = args.max_bytes ?? 200_000;

    const { buffer, contentType } = await client.getFileContentRaw(
      args.project_id,
      args.file_path,
      ref,
    );

    if (looksBinary(buffer, contentType)) {
      throw new Error(
        `${args.file_path} appears to be binary (content-type=${contentType ?? "unknown"}, found null byte in first ${SCAN_BYTES} bytes). Refusing to return content. Use list_repository_tree to discover binary assets and a different tool to inspect them.`,
      );
    }

    const totalBytes = buffer.byteLength;
    let content: string;
    let truncated = false;
    if (totalBytes > maxBytes) {
      truncated = true;
      content =
        buffer.subarray(0, maxBytes).toString("utf8") +
        TRUNCATE_MARKER(totalBytes, maxBytes);
      logTruncate({
        tool: "get_file_content",
        originalBytes: totalBytes,
        returnedBytes: maxBytes,
        limit: maxBytes,
        details: { path: args.file_path, ref },
      });
    } else {
      content = buffer.toString("utf8");
    }

    const text = JSON.stringify(
      {
        path: args.file_path,
        ref,
        size_bytes: totalBytes,
        content,
        truncated,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function looksBinary(buffer: Buffer, contentType: string | null): boolean {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (
      ct.startsWith("image/") ||
      ct.startsWith("video/") ||
      ct.startsWith("audio/") ||
      ct.startsWith("application/octet-stream") ||
      ct.startsWith("application/pdf") ||
      ct.startsWith("application/zip") ||
      ct.startsWith("application/x-tar") ||
      ct.startsWith("application/gzip") ||
      ct.startsWith("application/x-rar")
    ) {
      return true;
    }
  }
  const scanLen = Math.min(buffer.byteLength, SCAN_BYTES);
  for (let i = 0; i < scanLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
