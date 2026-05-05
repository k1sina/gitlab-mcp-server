import { afterEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeGetIssueHandler } from "../src/tools/get-issue.js";
import { installFetchMock, type QueuedResponse } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

const ISSUE_DETAIL = {
  id: 1268,
  iid: 22,
  project_id: 67,
  title: "Test issue",
  state: "opened",
  description: "Hello",
  labels: [],
  assignees: [],
  author: { id: 50, username: "sina", name: "S", web_url: "" },
  web_url: "https://jakota.dev/jakota/rostock-port/website/-/work_items/22",
  created_at: "2026-04-01T10:00:00Z",
  updated_at: "2026-04-28T10:00:00Z",
  due_date: null,
  milestone: null,
  closed_at: null,
  closed_by: null,
  user_notes_count: 0,
  references: {
    short: "#22",
    relative: "#22",
    full: "jakota/rostock-port/website#22",
  },
};

function statusResponse(
  status: { name: string; color?: string } | null,
): QueuedResponse {
  return {
    ok: true,
    status: 200,
    body: {
      data: {
        p_0: {
          workItems: {
            nodes: [
              {
                iid: "22",
                widgets: [
                  {},
                  {
                    status: status
                      ? {
                          id: "gid://gitlab/WorkItems::Statuses::Custom::Status/2",
                          name: status.name,
                          iconName: "status-running",
                          color: status.color ?? "#1f75cb",
                        }
                      : null,
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

describe("get_issue — status field", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("includes status: { name, color } when the GraphQL widget returns one", async () => {
    installFetchMock([
      { ok: true, status: 200, body: ISSUE_DETAIL }, // /issues/:iid
      { ok: true, status: 200, body: [] }, // /issues/:iid/notes
      statusResponse({ name: "In progress", color: "#1f75cb" }),
    ]);
    const handler = makeGetIssueHandler(newClient());
    const result = await handler({ project_id: 67, issue_iid: 22 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.issue.status).toEqual({
      name: "In progress",
      color: "#1f75cb",
    });
  });

  it("returns status: null when the work item has no status widget set (support project)", async () => {
    installFetchMock([
      { ok: true, status: 200, body: ISSUE_DETAIL },
      { ok: true, status: 200, body: [] },
      statusResponse(null),
    ]);
    const handler = makeGetIssueHandler(newClient());
    const result = await handler({ project_id: 67, issue_iid: 22 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.issue.status).toBeNull();
  });

  it("degrades gracefully to status: null when the GraphQL fetch errors", async () => {
    installFetchMock([
      { ok: true, status: 200, body: ISSUE_DETAIL },
      { ok: true, status: 200, body: [] },
      // GraphQL response with errors → graphql<T> throws → handler catches.
      {
        ok: true,
        status: 200,
        body: { errors: [{ message: "boom" }] },
      },
    ]);
    const handler = makeGetIssueHandler(newClient());
    const result = await handler({ project_id: 67, issue_iid: 22 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.issue.status).toBeNull();
  });

  it("does not change the existing REST request shape", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: ISSUE_DETAIL },
      { ok: true, status: 200, body: [] },
      statusResponse({ name: "To do" }),
    ]);
    const handler = makeGetIssueHandler(newClient());
    await handler({ project_id: 67, issue_iid: 22 });
    const restUrls = (fetchMock.mock.calls.slice(0, 2) as Array<
      [string, RequestInit]
    >).map(([u]) => u);
    expect(restUrls[0]).toBe(`${BASE_URL}/projects/67/issues/22`);
    expect(restUrls[1]).toBe(
      `${BASE_URL}/projects/67/issues/22/notes?sort=asc&per_page=100`,
    );
  });
});
