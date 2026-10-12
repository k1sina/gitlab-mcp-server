import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import {
  makeGetAttachmentHandler,
  parseUploadUrl,
} from "../src/tools/get-attachment.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";
const SECRET = "e1f3b0a3a3022d8711a43ebcb93d4d49";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

function meta(res: { content: Array<{ type: string; text?: string }> }) {
  return JSON.parse(res.content[0]!.text!);
}

describe("parseUploadUrl", () => {
  it("parses a relative /uploads link", () => {
    expect(parseUploadUrl(`/uploads/${SECRET}/shot.png`)).toEqual({
      secret: SECRET,
      filename: "shot.png",
    });
  });

  it("parses a full markdown snippet with GitLab's {width=..} suffix", () => {
    expect(
      parseUploadUrl(
        `![Bildschirmfoto](/uploads/${SECRET}/Bildschirmfoto_2026-10-12_um_09.32.17.png){width=900 height=360}`,
      ),
    ).toEqual({
      secret: SECRET,
      filename: "Bildschirmfoto_2026-10-12_um_09.32.17.png",
    });
  });

  it("takes the project path from an absolute web URL", () => {
    expect(
      parseUploadUrl(
        `https://jakota.dev/jakota/rostock-port/website/uploads/${SECRET}/a.png`,
      ),
    ).toEqual({
      secret: SECRET,
      filename: "a.png",
      projectId: "jakota/rostock-port/website",
    });
  });

  it("takes the numeric project id from a /-/project/<id>/uploads URL", () => {
    expect(
      parseUploadUrl(`https://jakota.dev/-/project/67/uploads/${SECRET}/a.png`),
    ).toEqual({ secret: SECRET, filename: "a.png", projectId: 67 });
  });

  it("decodes a percent-encoded filename", () => {
    expect(parseUploadUrl(`/uploads/${SECRET}/my%20file.pdf`).filename).toBe(
      "my file.pdf",
    );
  });

  it("rejects things that are not upload links", () => {
    expect(() => parseUploadUrl("https://example.com/foo.png")).toThrow(
      /not a GitLab upload link/,
    );
  });

  it("rejects group-level uploads", () => {
    expect(() =>
      parseUploadUrl(`https://jakota.dev/-/group/5/uploads/${SECRET}/a.png`),
    ).toThrow(/group-level upload/);
  });
});

describe("get_attachment", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("calls the uploads-by-secret API endpoint with the token", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: null, raw: PNG, contentType: "image/png" },
    ]);
    await makeGetAttachmentHandler(newClient())({
      project_id: 67,
      url: `![x](/uploads/${SECRET}/my%20shot.png){width=900}`,
    });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/67/uploads/${SECRET}/my%20shot.png`);
    expect((init.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe(TOKEN);
  });

  it("uses the project from an absolute URL when project_id is omitted", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: null, raw: PNG, contentType: "image/png" },
    ]);
    await makeGetAttachmentHandler(newClient())({
      url: `https://jakota.dev/jakota/support/uploads/${SECRET}/a.png`,
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/jakota%2Fsupport/uploads/${SECRET}/a.png`);
  });

  it("explains that relative links need project_id (no fetch)", async () => {
    const fetchMock = installFetchMock([]);
    await expect(
      makeGetAttachmentHandler(newClient())({ url: `/uploads/${SECRET}/a.png` }),
    ).rejects.toThrow(/need project_id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns images as an MCP image block, sniffing octet-stream bodies", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: null,
        raw: PNG,
        contentType: "application/octet-stream",
      },
    ]);
    const res = await makeGetAttachmentHandler(newClient())({
      project_id: 67,
      url: `/uploads/${SECRET}/a.png`,
    });
    expect(meta(res)).toMatchObject({
      kind: "image",
      mime_type: "image/png",
      size_bytes: PNG.byteLength,
    });
    expect(res.content[1]).toEqual({
      type: "image",
      data: PNG.toString("base64"),
      mimeType: "image/png",
    });
  });

  it("refuses to inline images over 5MB", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    installFetchMock([
      { ok: true, status: 200, body: null, raw: big, contentType: "image/png" },
    ]);
    const res = await makeGetAttachmentHandler(newClient())({
      project_id: 67,
      url: `/uploads/${SECRET}/a.png`,
    });
    expect(res.content).toHaveLength(1);
    expect(meta(res)).toMatchObject({ kind: "binary" });
    expect(meta(res).note).toMatch(/inline limit/);
  });

  it("returns PDFs as an embedded resource", async () => {
    const pdf = Buffer.from("%PDF-1.7\n...");
    installFetchMock([
      { ok: true, status: 200, body: null, raw: pdf, contentType: "application/pdf" },
    ]);
    const res = await makeGetAttachmentHandler(newClient())({
      project_id: 67,
      url: `/uploads/${SECRET}/spec.pdf`,
    });
    expect(meta(res).kind).toBe("pdf");
    expect(res.content[1]).toMatchObject({
      type: "resource",
      resource: { mimeType: "application/pdf", blob: pdf.toString("base64") },
    });
  });

  it("returns text attachments inline and truncates with a [TRUNCATE] line", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: null,
        raw: Buffer.from("line\n".repeat(100)),
        contentType: "text/plain",
      },
    ]);
    const res = await makeGetAttachmentHandler(newClient())({
      project_id: 67,
      url: `/uploads/${SECRET}/error.log`,
      max_bytes: 50,
    });
    const m = meta(res);
    expect(m).toMatchObject({ kind: "text", truncated: true, size_bytes: 500 });
    expect(m.content).toMatch(/^line\n/);
    expect(m.content).toMatch(/truncated, attachment is 500 bytes/);
    expect(stderr.text()).toMatch(/\[TRUNCATE\] tool=get_attachment original_bytes=500/);
  });

  it("returns metadata only for other binaries", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: null,
        raw: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
        contentType: "application/zip",
      },
    ]);
    const res = await makeGetAttachmentHandler(newClient())({
      project_id: 67,
      url: `/uploads/${SECRET}/export.docx`,
    });
    expect(res.content).toHaveLength(1);
    expect(meta(res)).toMatchObject({ kind: "binary", filename: "export.docx" });
  });

  it("surfaces 404 as a GitlabError", async () => {
    installFetchMock([
      { ok: false, status: 404, statusText: "Not Found", body: { message: "404 Not Found" } },
    ]);
    await expect(
      makeGetAttachmentHandler(newClient())({
        project_id: 67,
        url: `/uploads/${SECRET}/a.png`,
      }),
    ).rejects.toThrow(/404/);
  });
});
