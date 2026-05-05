import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeGetFileContentHandler } from "../src/tools/get-file-content.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

describe("get_file_content — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("URL-encodes the file_path (slashes → %2F) and forwards ref as a query param", async () => {
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 200,
        body: "console.log('hi');",
        contentType: "text/plain; charset=utf-8",
      },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await handler({
      project_id: 236,
      file_path: "src/components/Button.tsx",
      ref: "main",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/236/repository/files/src%2Fcomponents%2FButton.tsx/raw?ref=main`,
    );
    expect((init.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe(TOKEN);
  });

  it("encodes a path-style project_id alongside the file path", async () => {
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 200,
        body: "x",
        contentType: "text/plain",
      },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await handler({
      project_id: "jakota/support",
      file_path: "README.md",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/jakota%2Fsupport/repository/files/README.md/raw?ref=HEAD`,
    );
  });

  it("defaults ref to 'HEAD' when omitted", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: "x", contentType: "text/plain" },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await handler({ project_id: 236, file_path: "README.md" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toMatch(/[?&]ref=HEAD$/);
  });

  it("URL-encodes a ref that contains slashes (feature/foo)", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: "x", contentType: "text/plain" },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await handler({
      project_id: 236,
      file_path: "README.md",
      ref: "feature/foo-bar",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/236/repository/files/README.md/raw?ref=feature%2Ffoo-bar`,
    );
  });

  it("returns the file content verbatim when under max_bytes", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: "hello world\n",
        contentType: "text/plain",
      },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    const result = await handler({
      project_id: 236,
      file_path: "README.md",
    });
    const text = (result.content[0] as { text: string }).text;
    const json = JSON.parse(text);
    expect(json).toEqual({
      path: "README.md",
      ref: "HEAD",
      size_bytes: 12,
      content: "hello world\n",
      truncated: false,
    });
  });
});

describe("get_file_content — truncation", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("truncates at max_bytes and appends the marker", async () => {
    const big = "a".repeat(500);
    installFetchMock([
      { ok: true, status: 200, body: big, contentType: "text/plain" },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    const result = await handler({
      project_id: 236,
      file_path: "big.txt",
      max_bytes: 100,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.truncated).toBe(true);
    expect(json.size_bytes).toBe(500); // original
    expect(json.content.startsWith("a".repeat(100))).toBe(true);
    expect(json.content).toMatch(
      /\n\n\[\.\.\. truncated, file is 500 bytes total, requested max_bytes=100 \.\.\.\]$/,
    );
  });

  it("emits [TRUNCATE] to stderr with original/returned/limit", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: "a".repeat(500),
        contentType: "text/plain",
      },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await handler({ project_id: 236, file_path: "big.txt", max_bytes: 100 });
    expect(stderr.text()).toMatch(
      /^\[TRUNCATE\] tool=get_file_content original_bytes=500 returned_bytes=100 limit=100 path="big\.txt" ref="HEAD"\n/,
    );
  });

  it("does NOT log [TRUNCATE] when content fits", async () => {
    installFetchMock([
      { ok: true, status: 200, body: "small", contentType: "text/plain" },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await handler({ project_id: 236, file_path: "small.txt" });
    expect(stderr.text()).not.toContain("[TRUNCATE]");
  });
});

describe("get_file_content — binary refusal", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("refuses when first 8KB contains a null byte", async () => {
    const buf = Buffer.alloc(100);
    buf.write("hello", 0, "utf8");
    buf[60] = 0; // null byte well within 8KB scan window
    installFetchMock([
      { ok: true, status: 200, body: undefined, raw: buf, contentType: "text/plain" },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await expect(
      handler({ project_id: 236, file_path: "weird.bin" }),
    ).rejects.toThrow(/appears to be binary/);
  });

  it("refuses when content-type is application/octet-stream even without null bytes", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: "harmless",
        contentType: "application/octet-stream",
      },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await expect(
      handler({ project_id: 236, file_path: "blob.bin" }),
    ).rejects.toThrow(/appears to be binary/);
  });

  it("refuses image/* content types", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: "PNG-like-data",
        contentType: "image/png",
      },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    await expect(
      handler({ project_id: 236, file_path: "logo.png" }),
    ).rejects.toThrow(/appears to be binary/);
  });

  it("does NOT refuse on null bytes BEYOND the first 8KB", async () => {
    // 10KB of ASCII followed by a null — should still be treated as text
    // because the scan window is the first 8KB only.
    const buf = Buffer.alloc(10_240, "a".charCodeAt(0));
    buf[9000] = 0;
    installFetchMock([
      { ok: true, status: 200, body: undefined, raw: buf, contentType: "text/plain" },
    ]);
    const handler = makeGetFileContentHandler(newClient());
    const result = await handler({
      project_id: 236,
      file_path: "long-but-text.txt",
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.size_bytes).toBe(10_240);
    expect(json.truncated).toBe(false);
  });
});
