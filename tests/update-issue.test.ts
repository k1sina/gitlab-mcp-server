import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeUpdateIssueHandler } from "../src/tools/update-issue.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

const ISSUE_RESPONSE = {
  id: 9001,
  iid: 355,
  project_id: 236,
  title: "updated",
  state: "opened",
  description: null,
  labels: [],
  assignees: [],
  author: { id: 50, username: "sina", name: "Keivan", web_url: "" },
  web_url: "https://jakota.dev/jakota/support/-/issues/355",
  created_at: "2026-04-01T10:00:00Z",
  updated_at: "2026-04-28T10:00:00Z",
  due_date: null,
  milestone: null,
  closed_at: null,
  closed_by: null,
  user_notes_count: 0,
};

function newHarness(enableWrites = true) {
  const fetchMock = installFetchMock([
    { ok: true, status: 200, body: ISSUE_RESPONSE },
  ]);
  const client = new GitlabClient(BASE_URL, TOKEN);
  const handler = makeUpdateIssueHandler(client, enableWrites);
  return { fetchMock, handler };
}

describe("update_issue — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("title-only update sends PUT with only { title } in payload", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      title: "New title",
    });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/236/issues/355`);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({ title: "New title" });
  });

  it("labels replace mode sends comma-joined `labels` and no add/remove", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      labels: ["bug", "ci", "support"],
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ labels: "bug,ci,support" });
    expect(body).not.toHaveProperty("add_labels");
    expect(body).not.toHaveProperty("remove_labels");
  });

  it("labels: [] sends `labels: \"\"` (clears all labels)", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 236, issue_iid: 355, labels: [] });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ labels: "" });
  });

  it("add_labels + remove_labels both sent, no `labels` key", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      add_labels: ["needs-review"],
      remove_labels: ["wip", "blocked"],
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      add_labels: "needs-review",
      remove_labels: "wip,blocked",
    });
    expect(body).not.toHaveProperty("labels");
  });

  it("state_event close is forwarded verbatim", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      state_event: "close",
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ state_event: "close" });
  });

  it("state_event reopen is forwarded verbatim", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      state_event: "reopen",
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ state_event: "reopen" });
  });

  it("supports a fully-populated incremental update (every non-conflicting field)", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      title: "Updated title",
      description: "Updated body",
      add_labels: ["urgent"],
      remove_labels: ["stale"],
      assignee_ids: [50, 51],
      milestone_id: 12,
      state_event: "close",
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Updated title",
      description: "Updated body",
      add_labels: "urgent",
      remove_labels: "stale",
      assignee_ids: [50, 51],
      milestone_id: 12,
      state_event: "close",
    });
  });

  it("URL-encodes a path-style project_id", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: "jakota/support",
      issue_iid: 355,
      title: "x",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/jakota%2Fsupport/issues/355`);
  });

  it("logs [WRITE] PUT to stderr with the full payload", async () => {
    const { handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      title: "x",
      state_event: "close",
    });
    expect(stderr.text()).toMatch(
      /^\[WRITE\] PUT https:\/\/jakota\.dev\/api\/v4\/projects\/236\/issues\/355 payload=\{"title":"x","state_event":"close"\}\n/,
    );
  });

  it("refuses with isError when writes are disabled and never calls fetch", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateIssueHandler(client, false);
    await expect(
      handler({ project_id: 236, issue_iid: 355, title: "x" }),
    ).rejects.toThrow(/Writes are disabled.*update_issue/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the updated issue under content[0].text", async () => {
    const { handler } = newHarness();
    const result = await handler({
      project_id: 236,
      issue_iid: 355,
      title: "x",
    });
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ ok: true, issue: ISSUE_RESPONSE });
  });

  it("surfaces 4xx GitLab error detail (object message)", async () => {
    installFetchMock([
      {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        body: { message: { labels: ["'wat' is not a valid label"] } },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateIssueHandler(client, true);
    await expect(
      handler({ project_id: 236, issue_iid: 355, labels: ["wat"] }),
    ).rejects.toThrow(/is not a valid label/);
  });
});

describe("update_issue — labels conflict validation", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("rejects `labels` + `add_labels` together (no fetch)", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateIssueHandler(client, true);
    await expect(
      handler({
        project_id: 236,
        issue_iid: 355,
        labels: ["a"],
        add_labels: ["b"],
      }),
    ).rejects.toThrow(/ambiguous label intent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects `labels` + `remove_labels` together (no fetch)", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateIssueHandler(client, true);
    await expect(
      handler({
        project_id: 236,
        issue_iid: 355,
        labels: ["a"],
        remove_labels: ["b"],
      }),
    ).rejects.toThrow(/ambiguous label intent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects `labels` + both add and remove (no fetch)", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateIssueHandler(client, true);
    await expect(
      handler({
        project_id: 236,
        issue_iid: 355,
        labels: [],
        add_labels: ["b"],
        remove_labels: ["c"],
      }),
    ).rejects.toThrow(/ambiguous label intent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts add_labels + remove_labels alone (no labels)", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      add_labels: ["a"],
      remove_labels: ["b"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts `labels` alone (no add/remove)", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 236,
      issue_iid: 355,
      labels: ["a"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
