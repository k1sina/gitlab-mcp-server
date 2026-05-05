import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GitlabClient } from "../src/gitlab-client.js";
import {
  commentOnIssueInputShape,
  makeCommentOnIssueHandler,
} from "../src/tools/comment-on-issue.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

describe("comment_on_issue — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("POSTs the right URL/method/headers/body for a numeric project_id", async () => {
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 201,
        body: {
          id: 99,
          body: "hello",
          system: false,
          author: { username: "sina" },
          created_at: "2026-04-28T10:00:00Z",
        },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnIssueHandler(client, true);

    const result = await handler({
      project_id: 236,
      issue_iid: 355,
      body: "hello",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/236/issues/355/notes`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe(TOKEN);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ body: "hello" });

    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      note: {
        id: 99,
        body: "hello",
        system: false,
        author: { username: "sina" },
        created_at: "2026-04-28T10:00:00Z",
      },
    });
  });

  it("URL-encodes a path-style project_id", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: { id: 1 } },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnIssueHandler(client, true);
    await handler({
      project_id: "jakota/support",
      issue_iid: 355,
      body: "hi",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/jakota%2Fsupport/issues/355/notes`,
    );
  });

  it("logs [WRITE] to stderr before the fetch, including method, URL, and payload", async () => {
    installFetchMock([{ ok: true, status: 201, body: { id: 1 } }]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnIssueHandler(client, true);
    await handler({ project_id: 236, issue_iid: 355, body: "hello" });

    const log = stderr.text();
    expect(log).toMatch(
      /^\[WRITE\] POST https:\/\/jakota\.dev\/api\/v4\/projects\/236\/issues\/355\/notes payload=\{"body":"hello"\}\n/,
    );
  });

  it("throws and never calls fetch when writes are disabled", async () => {
    const fetchMock = installFetchMock([]); // empty — any call would throw "exhausted"
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnIssueHandler(client, false);
    await expect(
      handler({ project_id: 236, issue_iid: 355, body: "hi" }),
    ).rejects.toThrow(/Writes are disabled.*GITLAB_ENABLE_WRITES.*comment_on_issue/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces GitLab 4xx error detail in the thrown message", async () => {
    installFetchMock([
      {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        body: { message: "body is missing" },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnIssueHandler(client, true);
    await expect(
      handler({ project_id: 236, issue_iid: 355, body: "x" }),
    ).rejects.toThrow(/body is missing/);
  });

  it("surfaces structured GitLab validation errors (object message)", async () => {
    installFetchMock([
      {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        body: { message: { body: ["can't be blank"] } },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCommentOnIssueHandler(client, true);
    await expect(
      handler({ project_id: 236, issue_iid: 355, body: "x" }),
    ).rejects.toThrow(/can't be blank/);
  });
});

describe("comment_on_issue — input validation", () => {
  const schema = z.object(commentOnIssueInputShape);

  it("rejects empty body", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 355, body: "" }),
    ).toThrow();
  });

  it("rejects whitespace-only body", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 355, body: "   \n\t " }),
    ).toThrow();
  });

  it("accepts non-empty body", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 355, body: "x" }),
    ).not.toThrow();
  });

  it("accepts a path-style project_id", () => {
    expect(() =>
      schema.parse({ project_id: "jakota/support", issue_iid: 355, body: "x" }),
    ).not.toThrow();
  });

  it("rejects negative or zero issue_iid", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 0, body: "x" }),
    ).toThrow();
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: -1, body: "x" }),
    ).toThrow();
  });
});
