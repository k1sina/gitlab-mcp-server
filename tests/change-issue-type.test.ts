import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GitlabClient } from "../src/gitlab-client.js";
import {
  changeIssueTypeInputShape,
  makeChangeIssueTypeHandler,
} from "../src/tools/change-issue-type.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const GRAPHQL_URL = "https://jakota.dev/api/graphql";
const TOKEN = "glpat-test";

const ITEM_GID = "gid://gitlab/WorkItem/9012";
const TASK_TYPE_GID = "gid://gitlab/WorkItems::Type/5";

const RESOLVE_RESPONSE = {
  data: {
    project: {
      workItems: {
        nodes: [{ id: ITEM_GID, iid: "12", workItemType: { name: "Issue" } }],
      },
      workItemTypes: {
        nodes: [
          { id: "gid://gitlab/WorkItems::Type/1", name: "Issue" },
          { id: "gid://gitlab/WorkItems::Type/2", name: "Incident" },
          { id: TASK_TYPE_GID, name: "Task" },
          { id: "gid://gitlab/WorkItems::Type/8", name: "Epic" },
          { id: "gid://gitlab/WorkItems::Type/9", name: "Test Case" },
        ],
      },
    },
  },
};

const CONVERT_RESPONSE = {
  data: {
    workItemConvert: {
      errors: [],
      workItem: {
        iid: "12",
        title: "Some ticket",
        webUrl: "https://jakota.dev/jakota/support/-/work_items/12",
        workItemType: { name: "Task" },
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

describe("change_issue_type — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("resolves gid + type id in one query, then converts", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: RESOLVE_RESPONSE },
      { ok: true, status: 200, body: CONVERT_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);

    const result = await handler({
      project_id: "jakota/support",
      issue_iid: 12,
      new_type: "Task",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe(GRAPHQL_URL);
    expect(calls[1]![0]).toBe(GRAPHQL_URL);

    // Resolve query: iids travel as [String!]; types fetched alongside.
    const resolve = graphqlBody(calls[0]!);
    expect(resolve.query).toContain("workItemTypes");
    expect(resolve.variables).toEqual({
      path: "jakota/support",
      iids: ["12"],
    });

    const convert = graphqlBody(calls[1]!);
    expect(convert.query).toContain("workItemConvert");
    expect(convert.variables).toEqual({
      input: { id: ITEM_GID, workItemTypeId: TASK_TYPE_GID },
    });

    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      previous_type: "Issue",
      item: {
        iid: "12",
        title: "Some ticket",
        type: "Task",
        web_url: "https://jakota.dev/jakota/support/-/work_items/12",
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
      { ok: true, status: 200, body: RESOLVE_RESPONSE },
      { ok: true, status: 200, body: CONVERT_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);

    await handler({ project_id: 236, issue_iid: 12, new_type: "Task" });

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe(`${BASE_URL}/projects/236`);
    expect(graphqlBody(calls[1]!).variables?.path).toBe("jakota/support");
  });

  it("matches type names case-insensitively and tolerates underscores", async () => {
    // "test_case" should resolve to "Test Case"; expect its gid on the wire.
    const withTestCase = JSON.parse(JSON.stringify(CONVERT_RESPONSE));
    withTestCase.data.workItemConvert.workItem.workItemType.name = "Test Case";
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: RESOLVE_RESPONSE },
      { ok: true, status: 200, body: withTestCase },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);

    await handler({
      project_id: "jakota/support",
      issue_iid: 12,
      new_type: "test_case",
    });

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const convert = graphqlBody(calls[1]!);
    expect(convert.variables).toEqual({
      input: {
        id: ITEM_GID,
        workItemTypeId: "gid://gitlab/WorkItems::Type/9",
      },
    });
  });

  it("unknown type fails BEFORE mutating and lists the available types", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: RESOLVE_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 12,
        new_type: "Story",
      }),
    ).rejects.toThrow(/Unknown work item type "Story".*Issue, Incident, Task, Epic, Test Case/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("already the requested type: fails clearly without mutating", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: RESOLVE_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 12,
        new_type: "issue",
      }),
    ).rejects.toThrow(/already of type "Issue"/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs [WRITE] to stderr with the convert payload", async () => {
    installFetchMock([
      { ok: true, status: 200, body: RESOLVE_RESPONSE },
      { ok: true, status: 200, body: CONVERT_RESPONSE },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);
    await handler({
      project_id: "jakota/support",
      issue_iid: 12,
      new_type: "Task",
    });
    const log = stderr.text();
    expect(log).toContain(`[WRITE] GRAPHQL workItemConvert ${GRAPHQL_URL}`);
    expect(log).toContain(ITEM_GID);
    expect(log).toContain(TASK_TYPE_GID);
  });

  it("refuses and never calls fetch when writes are disabled", async () => {
    const fetchMock = installFetchMock([]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, false);
    await expect(
      handler({ project_id: 236, issue_iid: 12, new_type: "Task" }),
    ).rejects.toThrow(/Writes are disabled.*change_issue_type/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when the work item is not found", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: {
          data: {
            project: {
              workItems: { nodes: [] },
              workItemTypes: RESOLVE_RESPONSE.data.project.workItemTypes,
            },
          },
        },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 999,
        new_type: "Task",
      }),
    ).rejects.toThrow(/jakota\/support#999 not found/);
  });

  it("surfaces workItemConvert payload errors (e.g. disallowed conversion)", async () => {
    installFetchMock([
      { ok: true, status: 200, body: RESOLVE_RESPONSE },
      {
        ok: true,
        status: 200,
        body: {
          data: {
            workItemConvert: {
              errors: ["Provided type is not supported for this work item"],
              workItem: null,
            },
          },
        },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 12,
        new_type: "Epic",
      }),
    ).rejects.toThrow(/not supported for this work item/);
  });

  it("surfaces top-level GraphQL errors", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: { errors: [{ message: "Field 'workItemTypes' doesn't exist" }] },
      },
    ]);
    const client = new GitlabClient(BASE_URL, TOKEN);
    const handler = makeChangeIssueTypeHandler(client, true);
    await expect(
      handler({
        project_id: "jakota/support",
        issue_iid: 12,
        new_type: "Task",
      }),
    ).rejects.toThrow(/GitLab GraphQL error/);
  });
});

describe("change_issue_type — input validation", () => {
  const schema = z.object(changeIssueTypeInputShape);

  it("requires project_id, issue_iid, and new_type", () => {
    expect(() => schema.parse({ issue_iid: 1, new_type: "Task" })).toThrow();
    expect(() => schema.parse({ project_id: 236, new_type: "Task" })).toThrow();
    expect(() => schema.parse({ project_id: 236, issue_iid: 1 })).toThrow();
  });

  it("rejects empty or whitespace-only new_type", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 1, new_type: "" }),
    ).toThrow();
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 1, new_type: "   " }),
    ).toThrow();
  });

  it("rejects non-positive issue_iid", () => {
    expect(() =>
      schema.parse({ project_id: 236, issue_iid: 0, new_type: "Task" }),
    ).toThrow();
  });

  it("accepts a valid input", () => {
    expect(() =>
      schema.parse({
        project_id: "jakota/support",
        issue_iid: 12,
        new_type: "Incident",
      }),
    ).not.toThrow();
  });
});
