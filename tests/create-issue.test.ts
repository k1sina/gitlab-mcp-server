import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GitlabClient } from "../src/gitlab-client.js";
import {
  createIssueInputShape,
  makeCreateIssueHandler,
} from "../src/tools/create-issue.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

const ISSUE_RESPONSE = {
  id: 9001,
  iid: 1,
  project_id: 236,
  title: "test",
  state: "opened",
  description: null,
  labels: [],
  assignees: [],
  author: { id: 50, username: "sina", name: "Keivan", web_url: "" },
  web_url: "https://jakota.dev/jakota/support/-/issues/1",
  created_at: "2026-04-28T10:00:00Z",
  updated_at: "2026-04-28T10:00:00Z",
  due_date: null,
  milestone: null,
  closed_at: null,
  closed_by: null,
  user_notes_count: 0,
};

describe("create_issue — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("title-only call sends only { title } in the payload", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: ISSUE_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);

    await handler({ project_id: 236, title: "Add screenreader fixes" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/236/issues`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Add screenreader fixes",
    });
  });

  it("sends every supported field when provided, joining labels into a comma-separated string", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: ISSUE_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);

    await handler({
      project_id: 236,
      title: "Investigate flaky pipeline",
      description: "See logs at ...",
      labels: ["bug", "ci"],
      assignee_ids: [50, 51],
      milestone_id: 12,
      confidential: true,
    });

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Investigate flaky pipeline",
      description: "See logs at ...",
      labels: "bug,ci",
      assignee_ids: [50, 51],
      milestone_id: 12,
      confidential: true,
    });
  });

  it("URL-encodes a path-style project_id", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: ISSUE_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);
    await handler({ project_id: "jakota/support", title: "x" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/jakota%2Fsupport/issues`);
  });

  it("does not include omitted optional fields in the payload", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: ISSUE_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);
    await handler({ project_id: 236, title: "x", description: "y" });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ title: "x", description: "y" });
    expect(body).not.toHaveProperty("labels");
    expect(body).not.toHaveProperty("assignee_ids");
    expect(body).not.toHaveProperty("milestone_id");
    expect(body).not.toHaveProperty("confidential");
  });

  it("an empty labels array becomes an empty string (clears labels)", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 201, body: ISSUE_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);
    await handler({ project_id: 236, title: "x", labels: [] });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: "x", labels: "" });
  });

  it("logs [WRITE] to stderr including the full payload", async () => {
    installFetchMock([{ ok: true, status: 201, body: ISSUE_RESPONSE }]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);
    await handler({
      project_id: 236,
      title: "x",
      labels: ["bug"],
      confidential: true,
    });
    const log = stderr.text();
    expect(log).toMatch(/^\[WRITE\] POST /);
    expect(log).toContain(`${BASE_URL}/projects/236/issues`);
    expect(log).toContain('"title":"x"');
    expect(log).toContain('"labels":"bug"');
    expect(log).toContain('"confidential":true');
  });

  it("refuses with isError-shaped throw and never calls fetch when writes are disabled", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, false);
    await expect(
      handler({ project_id: 236, title: "x" }),
    ).rejects.toThrow(/Writes are disabled.*create_issue/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces structured 4xx validation errors", async () => {
    installFetchMock([
      {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        body: { message: { labels: ["'wat' is not a valid label"] } },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);
    await expect(
      handler({ project_id: 236, title: "x", labels: ["wat"] }),
    ).rejects.toThrow(/is not a valid label/);
  });

  it("returns the created issue verbatim under content[0].text", async () => {
    installFetchMock([{ ok: true, status: 201, body: ISSUE_RESPONSE }]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeCreateIssueHandler(client, true);
    const result = await handler({ project_id: 236, title: "test" });
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ ok: true, issue: ISSUE_RESPONSE });
  });
});

describe("create_issue — input validation", () => {
  const schema = z.object(createIssueInputShape);

  it("rejects empty title", () => {
    expect(() => schema.parse({ project_id: 236, title: "" })).toThrow();
  });

  it("rejects whitespace-only title", () => {
    expect(() => schema.parse({ project_id: 236, title: "   " })).toThrow();
  });

  it("requires project_id and title", () => {
    expect(() => schema.parse({ title: "x" })).toThrow();
    expect(() => schema.parse({ project_id: 236 })).toThrow();
  });

  it("rejects non-positive assignee_ids", () => {
    expect(() =>
      schema.parse({ project_id: 236, title: "x", assignee_ids: [0] }),
    ).toThrow();
    expect(() =>
      schema.parse({ project_id: 236, title: "x", assignee_ids: [-1] }),
    ).toThrow();
  });

  it("rejects non-string labels", () => {
    expect(() =>
      schema.parse({ project_id: 236, title: "x", labels: [123 as unknown as string] }),
    ).toThrow();
  });

  it("accepts a fully-populated valid input", () => {
    expect(() =>
      schema.parse({
        project_id: "jakota/support",
        title: "x",
        description: "y",
        labels: ["bug"],
        assignee_ids: [50],
        milestone_id: 12,
        confidential: true,
      }),
    ).not.toThrow();
  });
});
