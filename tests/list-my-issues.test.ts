import { afterEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeListMyIssuesHandler } from "../src/tools/list-my-issues.js";
import { installFetchMock, type QueuedResponse } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

interface MockIssueOpts {
  iid: number;
  project_id?: number;
  project_path?: string; // becomes references.full and the work_items path
  title?: string;
  state?: "opened" | "closed";
  noReferences?: boolean; // simulate REST shape without `references` (forces web_url fallback)
}

function mockIssue(o: MockIssueOpts) {
  const path = o.project_path ?? "jakota/rostock-port/website";
  const issue: Record<string, unknown> = {
    id: o.iid + 1000,
    iid: o.iid,
    project_id: o.project_id ?? 67,
    title: o.title ?? `Issue ${o.iid}`,
    state: o.state ?? "opened",
    web_url: `https://jakota.dev/${path}/-/work_items/${o.iid}`,
    labels: [],
    assignees: [],
    author: { id: 50, username: "sina", name: "S", web_url: "" },
    created_at: "2026-04-01T10:00:00Z",
    updated_at: "2026-04-28T10:00:00Z",
    due_date: null,
    milestone: null,
  };
  if (!o.noReferences) {
    issue.references = {
      short: `#${o.iid}`,
      relative: `#${o.iid}`,
      full: `${path}#${o.iid}`,
    };
  }
  return issue;
}

/** Build the GraphQL response for a fetchWorkItemStatuses call. */
function statusGraphqlResponse(
  perProject: Array<{
    alias: string; // p_0, p_1, ...
    items: Array<{ iid: number; status: { id?: string; name: string; iconName?: string; color?: string } | null }>;
  }>,
): QueuedResponse {
  const data: Record<string, unknown> = {};
  for (const p of perProject) {
    data[p.alias] = {
      workItems: {
        nodes: p.items.map(({ iid, status }) => ({
          iid: String(iid),
          // First widget is empty (mimics non-status widgets), second has the status field.
          widgets: [
            {},
            {
              status: status
                ? {
                    id: status.id ?? "gid://gitlab/WorkItems::Statuses::Custom::Status/1",
                    name: status.name,
                    iconName: status.iconName ?? "status-running",
                    color: status.color ?? "#1f75cb",
                  }
                : null,
            },
          ],
        })),
      },
    };
  }
  return { ok: true, status: 200, body: { data } };
}

describe("list_my_issues — actionable-by-default filter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("default call: keeps To do + In progress, drops Done + Internal Review, ALWAYS keeps null-status (support project)", async () => {
    const issues = [
      mockIssue({
        iid: 1,
        project_id: 67,
        project_path: "jakota/rostock-port/website",
      }),
      mockIssue({
        iid: 2,
        project_id: 67,
        project_path: "jakota/rostock-port/website",
      }),
      mockIssue({
        iid: 3,
        project_id: 67,
        project_path: "jakota/rostock-port/website",
      }),
      mockIssue({
        iid: 4,
        project_id: 67,
        project_path: "jakota/rostock-port/website",
      }),
      mockIssue({
        iid: 99,
        project_id: 236,
        project_path: "jakota/support",
      }),
    ];
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: issues },
      statusGraphqlResponse([
        {
          alias: "p_0",
          items: [
            { iid: 1, status: { name: "To do" } },
            { iid: 2, status: { name: "In progress" } },
            { iid: 3, status: { name: "Done" } },
            { iid: 4, status: { name: "Internal Review" } },
          ],
        },
        {
          alias: "p_1",
          items: [{ iid: 99, status: null }],
        },
      ]),
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    const result = await handler({});
    const json = JSON.parse((result.content[0] as { text: string }).text);

    expect(json.applied_status_filter).toEqual(["To do", "In progress"]);
    expect(json.count).toBe(3);
    expect(json.issues.map((i: { issue_iid: number }) => i.issue_iid).sort())
      .toEqual([1, 2, 99]);
    // Per-issue status field
    const byIid = Object.fromEntries(
      json.issues.map((i: { issue_iid: number; status: unknown }) => [
        i.issue_iid,
        i.status,
      ]),
    );
    expect(byIid[1]).toEqual({ name: "To do", color: "#1f75cb" });
    expect(byIid[2]).toEqual({ name: "In progress", color: "#1f75cb" });
    expect(byIid[99]).toBeNull();
    // Two HTTP calls total: REST list + one batched GraphQL.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("with status: [] disables the filter — NO GraphQL call is made", async () => {
    const issues = [mockIssue({ iid: 1 }), mockIssue({ iid: 2 })];
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: issues },
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    const result = await handler({ status: [] });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.applied_status_filter).toBeNull();
    expect(json.count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1); // REST only
  });

  it("state='closed' clears the status default — NO GraphQL call is made", async () => {
    const issues = [
      mockIssue({ iid: 1, state: "closed" }),
      mockIssue({ iid: 2, state: "closed" }),
    ];
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: issues },
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    const result = await handler({ state: "closed" });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.applied_status_filter).toBeNull();
    expect(json.count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("state='all' clears the status default — NO GraphQL call is made", async () => {
    const issues = [mockIssue({ iid: 1 })];
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: issues },
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    const result = await handler({ state: "all" });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.applied_status_filter).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explicit status: ['Internal Review'] keeps only that status (and null-status)", async () => {
    const issues = [
      mockIssue({ iid: 1 }),
      mockIssue({ iid: 2 }),
      mockIssue({ iid: 99, project_path: "jakota/support" }),
    ];
    installFetchMock([
      { ok: true, status: 200, body: issues },
      statusGraphqlResponse([
        {
          alias: "p_0",
          items: [
            { iid: 1, status: { name: "Internal Review" } },
            { iid: 2, status: { name: "To do" } },
          ],
        },
        {
          alias: "p_1",
          items: [{ iid: 99, status: null }],
        },
      ]),
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    const result = await handler({ status: ["Internal Review"] });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.applied_status_filter).toEqual(["Internal Review"]);
    expect(
      json.issues.map((i: { issue_iid: number }) => i.issue_iid).sort(),
    ).toEqual([1, 99]);
  });

  it("when references is missing, falls back to web_url to derive project path", async () => {
    const issues = [mockIssue({ iid: 1, noReferences: true })];
    installFetchMock([
      { ok: true, status: 200, body: issues },
      statusGraphqlResponse([
        {
          alias: "p_0",
          items: [{ iid: 1, status: { name: "To do" } }],
        },
      ]),
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    const result = await handler({});
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.count).toBe(1);
    expect(json.issues[0].status).toEqual({
      name: "To do",
      color: "#1f75cb",
    });
  });
});

describe("list_my_issues — REST request shape unchanged", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards state and per_page exactly as before", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    await handler({ state: "all", limit: 10 });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/issues?scope=assigned_to_me&per_page=10`,
    );
  });
});

describe("list_my_issues — GraphQL request shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("batches all (project, iid) pairs into ONE GraphQL POST regardless of project count", async () => {
    const issues = [
      mockIssue({ iid: 1, project_path: "g/a" }),
      mockIssue({ iid: 2, project_path: "g/a" }),
      mockIssue({ iid: 3, project_path: "g/b" }),
      mockIssue({ iid: 4, project_path: "g/c" }),
    ];
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: issues },
      statusGraphqlResponse([
        { alias: "p_0", items: [{ iid: 1, status: { name: "To do" } }, { iid: 2, status: { name: "Done" } }] },
        { alias: "p_1", items: [{ iid: 3, status: { name: "In progress" } }] },
        { alias: "p_2", items: [{ iid: 4, status: { name: "Done" } }] },
      ]),
    ]);
    const handler = makeListMyIssuesHandler(newClient(), ["To do","In progress"]);
    await handler({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const graphqlCall = fetchMock.mock.calls[1]! as [string, RequestInit];
    expect(graphqlCall[0]).toBe("https://jakota.dev/api/graphql");
    expect(graphqlCall[1].method).toBe("POST");
    expect((graphqlCall[1].headers as Record<string, string>)["Content-Type"])
      .toBe("application/json");
    const body = JSON.parse(graphqlCall[1].body as string);
    expect(typeof body.query).toBe("string");
    expect(body.query).toMatch(/p_0: project\(fullPath: \$path0\)/);
    expect(body.query).toMatch(/p_1: project\(fullPath: \$path1\)/);
    expect(body.query).toMatch(/p_2: project\(fullPath: \$path2\)/);
    // Regression guard — workItems(iids:) is [String!] in GitLab 18.x, not [ID!].
    // A previous version of this code declared [ID!]! and got a server-side
    // type-mismatch on every call.
    expect(body.query).toMatch(/\$iids0: \[String!\]!/);
    expect(body.query).not.toMatch(/\$iids0: \[ID!\]/);
    expect(body.variables).toEqual({
      path0: "g/a",
      iids0: ["1", "2"],
      path1: "g/b",
      iids1: ["3"],
      path2: "g/c",
      iids2: ["4"],
    });
  });
});
