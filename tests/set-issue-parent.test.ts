import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GitlabClient } from "../src/gitlab-client.js";
import {
  setIssueParentInputShape,
  makeSetIssueParentHandler,
} from "../src/tools/set-issue-parent.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const GRAPHQL_URL = "https://jakota.dev/api/graphql";
const TOKEN = "glpat-test";

const CHILD_GID = "gid://gitlab/WorkItem/9012";
const PARENT_GID = "gid://gitlab/WorkItem/9005";

const RESOLVE_BOTH_RESPONSE = {
  data: {
    child: { workItems: { nodes: [{ id: CHILD_GID, iid: "12" }] } },
    parent: { workItems: { nodes: [{ id: PARENT_GID, iid: "5" }] } },
  },
};

const MUTATION_RESPONSE = {
  data: {
    workItemUpdate: {
      errors: [],
      workItem: {
        iid: "12",
        title: "Child ticket",
        webUrl: "https://jakota.dev/jakota/support/-/work_items/12",
        workItemType: { name: "Task" },
        widgets: [
          {},
          {
            parent: {
              iid: "5",
              title: "Parent ticket",
              webUrl: "https://jakota.dev/jakota/support/-/work_items/5",
              workItemType: { name: "Issue" },
            },
          },
        ],
      },
    },
  },
};

function graphqlBody(call: [string, RequestInit]): {
  query: string;
  variables?: Record<string, unknown>;
} {
  return JSON.parse(call[1].body as string);
}

describe("set_issue_parent — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("path-style project_id: resolves gids then mutates, both via GraphQL", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: RESOLVE_BOTH_RESPONSE },
      { ok: true, status: 200, body: MUTATION_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);

    const result = await handler({
      project_id: "jakota/support",
      issue_iid: 12,
      parent_issue_iid: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe(GRAPHQL_URL);
    expect(calls[1]![0]).toBe(GRAPHQL_URL);

    // Resolve query: iids travel as [String!], child and parent aliased.
    const resolve = graphqlBody(calls[0]!);
    expect(resolve.query).toContain("workItems(iids:");
    expect(resolve.variables).toEqual({
      childPath: "jakota/support",
      childIids: ["12"],
      parentPath: "jakota/support",
      parentIids: ["5"],
    });

    // Mutation: hierarchyWidget with the resolved gids.
    const mutation = graphqlBody(calls[1]!);
    expect(mutation.query).toContain("workItemUpdate");
    expect(mutation.variables).toEqual({
      input: { id: CHILD_GID, hierarchyWidget: { parentId: PARENT_GID } },
    });

    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      child: {
        iid: "12",
        title: "Child ticket",
        type: "Task",
        web_url: "https://jakota.dev/jakota/support/-/work_items/12",
      },
      parent: {
        iid: "5",
        title: "Parent ticket",
        type: "Issue",
        web_url: "https://jakota.dev/jakota/support/-/work_items/5",
      },
    });
  });

  it("numeric project_id: looks up the project path via REST first", async () => {
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 200,
        body: { id: 236, path_with_namespace: "jakota/support" },
      },
      { ok: true, status: 200, body: RESOLVE_BOTH_RESPONSE },
      { ok: true, status: 200, body: MUTATION_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);

    await handler({ project_id: 236, issue_iid: 12, parent_issue_iid: 5 });

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe(`${BASE_URL}/projects/236`);
    const resolve = graphqlBody(calls[1]!);
    expect(resolve.variables?.childPath).toBe("jakota/support");
  });

  it("cross-project parent: resolves parent_project_id separately", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: RESOLVE_BOTH_RESPONSE },
      { ok: true, status: 200, body: MUTATION_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);

    await handler({
      project_id: "jakota/support",
      issue_iid: 12,
      parent_issue_iid: 5,
      parent_project_id: "jakota/platform",
    });

    const resolve = graphqlBody(
      fetchMock.mock.calls[0]! as [string, RequestInit],
    );
    expect(resolve.variables).toEqual({
      childPath: "jakota/support",
      childIids: ["12"],
      parentPath: "jakota/platform",
      parentIids: ["5"],
    });
  });

  it("remove_parent: resolves only the child and sends parentId null", async () => {
    const removalMutation = JSON.parse(JSON.stringify(MUTATION_RESPONSE));
    removalMutation.data.workItemUpdate.workItem.widgets = [
      {},
      { parent: null },
    ];
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 200,
        body: {
          data: {
            child: { workItems: { nodes: [{ id: CHILD_GID, iid: "12" }] } },
          },
        },
      },
      { ok: true, status: 200, body: removalMutation },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);

    const result = await handler({
      project_id: "jakota/support",
      issue_iid: 12,
      remove_parent: true,
    });

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const resolve = graphqlBody(calls[0]!);
    expect(resolve.variables).toEqual({
      childPath: "jakota/support",
      childIids: ["12"],
    });
    const mutation = graphqlBody(calls[1]!);
    expect(mutation.variables).toEqual({
      input: { id: CHILD_GID, hierarchyWidget: { parentId: null } },
    });

    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text).parent).toBeNull();
  });

  it("logs [WRITE] to stderr with the mutation payload", async () => {
    installFetchMock([
      { ok: true, status: 200, body: RESOLVE_BOTH_RESPONSE },
      { ok: true, status: 200, body: MUTATION_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);
    await handler({
      project_id: "jakota/support",
      issue_iid: 12,
      parent_issue_iid: 5,
    });
    const log = stderr.text();
    expect(log).toContain(`[WRITE] GRAPHQL workItemUpdate ${GRAPHQL_URL}`);
    expect(log).toContain(CHILD_GID);
    expect(log).toContain(PARENT_GID);
  });

  it("refuses and never calls fetch when writes are disabled", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, false);
    await expect(
      handler({ project_id: 236, issue_iid: 12, parent_issue_iid: 5 }),
    ).rejects.toThrow(/Writes are disabled.*set_issue_parent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when neither parent_issue_iid nor remove_parent is given", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);
    await expect(
      handler({ project_id: 236, issue_iid: 12 }),
    ).rejects.toThrow(/parent_issue_iid is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when both parent_issue_iid and remove_parent are given", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);
    await expect(
      handler({
        project_id: 236,
        issue_iid: 12,
        parent_issue_iid: 5,
        remove_parent: true,
      }),
    ).rejects.toThrow(/not both/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when the child work item is not found", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: { data: { child: { workItems: { nodes: [] } }, parent: null } },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 999,
        parent_issue_iid: 5,
      }),
    ).rejects.toThrow(/jakota\/support#999 not found/);
  });

  it("surfaces a clear error when the parent work item is not found", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: {
          data: {
            child: { workItems: { nodes: [{ id: CHILD_GID, iid: "12" }] } },
            parent: { workItems: { nodes: [] } },
          },
        },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 12,
        parent_issue_iid: 999,
      }),
    ).rejects.toThrow(/Parent work item jakota\/support#999 not found/);
  });

  it("surfaces workItemUpdate payload errors (e.g. disallowed type nesting)", async () => {
    installFetchMock([
      { ok: true, status: 200, body: RESOLVE_BOTH_RESPONSE },
      {
        ok: true,
        status: 200,
        body: {
          data: {
            workItemUpdate: {
              errors: ["Work item type Issue cannot be added to Issue"],
              workItem: null,
            },
          },
        },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 12,
        parent_issue_iid: 5,
      }),
    ).rejects.toThrow(/cannot be added to Issue/);
  });

  it("surfaces top-level GraphQL errors", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: { errors: [{ message: "Field 'workItems' doesn't exist" }] },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeSetIssueParentHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 12,
        parent_issue_iid: 5,
      }),
    ).rejects.toThrow(/GitLab GraphQL error/);
  });
});

describe("set_issue_parent — input validation", () => {
  const schema = z.object(setIssueParentInputShape);

  it("requires project_id and issue_iid", () => {
    expect(() => schema.parse({ issue_iid: 1 })).toThrow();
    expect(() => schema.parse({ project_id: 236 })).toThrow();
  });

  it("rejects non-positive iids", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 0, parent_issue_iid: 5 }),
    ).toThrow();
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 1, parent_issue_iid: -5 }),
    ).toThrow();
  });

  it("accepts set and remove shapes", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 12, parent_issue_iid: 5 }),
    ).not.toThrow();
    expect(() =>
      schema.parse({
        project_id: "jakota/support",
        issue_iid: 12,
        remove_parent: true,
      }),
    ).not.toThrow();
  });
});
