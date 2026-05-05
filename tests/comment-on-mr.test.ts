import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GitlabClient } from "../src/gitlab-client.js";
import {
  commentOnMrInputShape,
  makeCommentOnMrHandler,
} from "../src/tools/comment-on-mr.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

describe("comment_on_mr — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("POSTs to /merge_requests/:iid/notes, not /issues/", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: { id: 7 } },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnMrHandler(client, true);
    await handler({ project_id: 89, mr_iid: 3137, body: "lgtm" });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/89/merge_requests/3137/notes`);
    expect(url).not.toMatch(/\/issues\//);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe(TOKEN);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ body: "lgtm" });
  });

  it("URL-encodes path-style project_id", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: { id: 1 } },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnMrHandler(client, true);
    await handler({
      project_id: "jakota/group/repo",
      mr_iid: 3137,
      body: "hi",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/jakota%2Fgroup%2Frepo/merge_requests/3137/notes`,
    );
  });

  it("logs [WRITE] to stderr unconditionally", async () => {
    installFetchMock([{ ok: true, status: 201, body: { id: 1 } }]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnMrHandler(client, true);
    await handler({ project_id: 89, mr_iid: 3137, body: "lgtm" });
    expect(stderr.text()).toMatch(
      /^\[WRITE\] POST https:\/\/jakota\.dev\/api\/v4\/projects\/89\/merge_requests\/3137\/notes payload=\{"body":"lgtm"\}\n/,
    );
  });

  it("refuses when writes are disabled and never calls fetch", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnMrHandler(client, false);
    await expect(
      handler({ project_id: 89, mr_iid: 3137, body: "lgtm" }),
    ).rejects.toThrow(/Writes are disabled.*comment_on_mr/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("comment_on_mr — input validation", () => {
  const schema = z.object(commentOnMrInputShape);

  it("rejects empty / whitespace-only body", () => {
    expect(() =>
      schema.parse({ project_id: 89, mr_iid: 3137, body: "" }),
    ).toThrow();
    expect(() =>
      schema.parse({ project_id: 89, mr_iid: 3137, body: "  \n  " }),
    ).toThrow();
  });

  it("rejects non-positive mr_iid", () => {
    expect(() =>
      schema.parse({ project_id: 89, mr_iid: 0, body: "x" }),
    ).toThrow();
  });

  it("accepts valid input", () => {
    expect(() =>
      schema.parse({ project_id: 89, mr_iid: 3137, body: "lgtm" }),
    ).not.toThrow();
  });
});
