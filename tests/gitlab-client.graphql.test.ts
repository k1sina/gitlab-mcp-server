import { afterEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

describe("graphql() transport (exercised via fetchWorkItemStatuses)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("derives the GraphQL URL from the REST baseUrl (/api/vN → /api/graphql)", async () => {
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 200,
        body: { data: { p_0: { workItems: { nodes: [] } } } },
      },
    ]);
    await newClient().fetchWorkItemStatuses([
      { projectPath: "g/a", iid: 1 },
    ]);
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://jakota.dev/api/graphql");
  });

  it("uses POST + Content-Type application/json + PRIVATE-TOKEN", async () => {
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 200,
        body: { data: { p_0: { workItems: { nodes: [] } } } },
      },
    ]);
    await newClient().fetchWorkItemStatuses([
      { projectPath: "g/a", iid: 1 },
    ]);
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["PRIVATE-TOKEN"]).toBe(TOKEN);
  });

  it("sends body of shape { query, variables }", async () => {
    const fetchMock = installFetchMock([
      {
        ok: true,
        status: 200,
        body: { data: { p_0: { workItems: { nodes: [] } } } },
      },
    ]);
    await newClient().fetchWorkItemStatuses([
      { projectPath: "g/a", iid: 1 },
      { projectPath: "g/a", iid: 2 },
    ]);
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(typeof body.query).toBe("string");
    expect(body.query).toContain("WorkItemWidgetStatus");
    expect(body.variables).toEqual({ path0: "g/a", iids0: ["1", "2"] });
  });

  it("throws GitlabError when GraphQL response carries `errors`", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: {
          errors: [
            { message: "Field 'foo' doesn't exist on type 'Project'" },
          ],
        },
      },
    ]);
    await expect(
      newClient().fetchWorkItemStatuses([{ projectPath: "g/a", iid: 1 }]),
    ).rejects.toThrow(/GitLab GraphQL error.*Field 'foo'/);
  });

  it("throws GitlabError when response has no `data` field", async () => {
    installFetchMock([{ ok: true, status: 200, body: {} }]);
    await expect(
      newClient().fetchWorkItemStatuses([{ projectPath: "g/a", iid: 1 }]),
    ).rejects.toThrow(/no `data` field/);
  });

  it("propagates 4xx via the existing error-formatting pipeline", async () => {
    installFetchMock([
      {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        body: { message: "401 Unauthorized" },
      },
    ]);
    await expect(
      newClient().fetchWorkItemStatuses([{ projectPath: "g/a", iid: 1 }]),
    ).rejects.toThrow(/401/);
  });

  it("returns an empty Map (no fetch) when given no items", async () => {
    const fetchMock = installFetchMock([]);
    const map = await newClient().fetchWorkItemStatuses([]);
    expect(map.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchWorkItemStatuses — return shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a Map keyed by `${path}#${iid}` with the parsed widget status", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: {
          data: {
            p_0: {
              workItems: {
                nodes: [
                  {
                    iid: "1",
                    widgets: [
                      {},
                      {
                        status: {
                          id: "gid://gitlab/WorkItems::Statuses::Custom::Status/1",
                          name: "To do",
                          iconName: "status-waiting",
                          color: "#737278",
                        },
                      },
                    ],
                  },
                  {
                    iid: "2",
                    widgets: [
                      {},
                      {
                        status: null,
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    ]);
    const map = await newClient().fetchWorkItemStatuses([
      { projectPath: "g/a", iid: 1 },
      { projectPath: "g/a", iid: 2 },
    ]);
    expect(map.get("g/a#1")).toEqual({
      id: "gid://gitlab/WorkItems::Statuses::Custom::Status/1",
      name: "To do",
      iconName: "status-waiting",
      color: "#737278",
    });
    expect(map.get("g/a#2")).toBeNull();
  });
});
