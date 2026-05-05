import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeUpdateMergeRequestHandler } from "../src/tools/update-merge-request.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

const MR_RESPONSE = {
  id: 1234,
  iid: 3137,
  project_id: 89,
  title: "feat: enhance accessibility",
  state: "opened",
  description: null,
  labels: [],
  source_branch: "support-355",
  target_branch: "develop",
  draft: false,
  merge_status: "mergeable",
  detailed_merge_status: "mergeable",
  has_conflicts: false,
  assignees: [],
  reviewers: [],
  author: { id: 50, username: "sina", name: "Keivan", web_url: "" },
  milestone: null,
  web_url: "https://jakota.dev/jakota/x/-/merge_requests/3137",
  user_notes_count: 0,
  changes_count: "8",
  created_at: "2026-04-27T13:53:40.844Z",
  updated_at: "2026-04-28T10:00:00Z",
  merged_at: null,
  closed_at: null,
};

function newHarness(enableWrites = true) {
  const fetchMock = installFetchMock([
    { ok: true, status: 200, body: MR_RESPONSE },
  ]);
  const client = new GitlabClient(BASE_URL, TOKEN);
  const handler = makeUpdateMergeRequestHandler(client, enableWrites);
  return { fetchMock, handler };
}

describe("update_merge_request — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("title-only update PUTs to /merge_requests/:iid (not /issues/) with only { title }", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, title: "New title" });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/89/merge_requests/3137`);
    expect(url).not.toMatch(/\/issues\//);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({ title: "New title" });
  });

  it("labels replace mode sends comma-joined `labels`", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 89,
      mr_iid: 3137,
      labels: ["needs-review", "frontend"],
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      labels: "needs-review,frontend",
    });
  });

  it("labels: [] sends `labels: \"\"`", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, labels: [] });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ labels: "" });
  });

  it("add_labels + remove_labels both forwarded, no `labels` key", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 89,
      mr_iid: 3137,
      add_labels: ["needs-review"],
      remove_labels: ["wip"],
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      add_labels: "needs-review",
      remove_labels: "wip",
    });
    expect(body).not.toHaveProperty("labels");
  });

  it("state_event close is forwarded verbatim", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, state_event: "close" });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ state_event: "close" });
  });

  it("state_event reopen is forwarded verbatim", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, state_event: "reopen" });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ state_event: "reopen" });
  });

  it("draft=true is forwarded as a boolean (not a string, not 1)", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, draft: true });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ draft: true });
    expect(body.draft).toBe(true);
    expect(typeof body.draft).toBe("boolean");
  });

  it("draft=false clears the draft flag and is forwarded verbatim", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, draft: false });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ draft: false });
  });

  it("reviewer_ids forwarded as a JSON array of numbers", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 89,
      mr_iid: 3137,
      reviewer_ids: [50, 51, 52],
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      reviewer_ids: [50, 51, 52],
    });
  });

  it("reviewer_ids: [] clears all reviewers", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, reviewer_ids: [] });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ reviewer_ids: [] });
  });

  it("supports a fully-populated incremental update including draft and reviewer_ids", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 89,
      mr_iid: 3137,
      title: "Updated title",
      description: "Updated body",
      add_labels: ["urgent"],
      remove_labels: ["stale"],
      assignee_ids: [50],
      reviewer_ids: [51, 52],
      milestone_id: 12,
      state_event: "close",
      draft: true,
    });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Updated title",
      description: "Updated body",
      add_labels: "urgent",
      remove_labels: "stale",
      assignee_ids: [50],
      reviewer_ids: [51, 52],
      milestone_id: 12,
      state_event: "close",
      draft: true,
    });
  });

  it("URL-encodes a path-style project_id", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: "jakota/group/repo",
      mr_iid: 3137,
      title: "x",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/jakota%2Fgroup%2Frepo/merge_requests/3137`,
    );
  });

  it("logs [WRITE] PUT to stderr with the full payload", async () => {
    const { handler } = newHarness();
    await handler({
      project_id: 89,
      mr_iid: 3137,
      draft: true,
      add_labels: ["needs-review"],
    });
    expect(stderr.text()).toMatch(
      /^\[WRITE\] PUT https:\/\/jakota\.dev\/api\/v4\/projects\/89\/merge_requests\/3137 payload=\{"add_labels":"needs-review","draft":true\}\n/,
    );
  });

  it("refuses with isError when writes are disabled and never calls fetch", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateMergeRequestHandler(client, false);
    await expect(
      handler({ project_id: 89, mr_iid: 3137, title: "x" }),
    ).rejects.toThrow(/Writes are disabled.*update_merge_request/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the updated MR under content[0].text as { ok, merge_request }", async () => {
    const { handler } = newHarness();
    const result = await handler({ project_id: 89, mr_iid: 3137, title: "x" });
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      merge_request: MR_RESPONSE,
    });
  });

  it("surfaces 4xx GitLab error detail (object message)", async () => {
    installFetchMock([
      {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        body: { message: { reviewer_ids: ["does not exist"] } },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateMergeRequestHandler(client, true);
    await expect(
      handler({ project_id: 89, mr_iid: 3137, reviewer_ids: [99999] }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("update_merge_request — labels conflict validation", () => {
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
    const handler = makeUpdateMergeRequestHandler(client, true);
    await expect(
      handler({
        project_id: 89,
        mr_iid: 3137,
        labels: ["a"],
        add_labels: ["b"],
      }),
    ).rejects.toThrow(/ambiguous label intent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects `labels` + `remove_labels` together (no fetch)", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateMergeRequestHandler(client, true);
    await expect(
      handler({
        project_id: 89,
        mr_iid: 3137,
        labels: ["a"],
        remove_labels: ["b"],
      }),
    ).rejects.toThrow(/ambiguous label intent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects `labels` + both add and remove (no fetch)", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeUpdateMergeRequestHandler(client, true);
    await expect(
      handler({
        project_id: 89,
        mr_iid: 3137,
        labels: [],
        add_labels: ["b"],
        remove_labels: ["c"],
      }),
    ).rejects.toThrow(/ambiguous label intent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts add_labels + remove_labels alone", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({
      project_id: 89,
      mr_iid: 3137,
      add_labels: ["a"],
      remove_labels: ["b"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts `labels` alone", async () => {
    const { fetchMock, handler } = newHarness();
    await handler({ project_id: 89, mr_iid: 3137, labels: ["a"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
