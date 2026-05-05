import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import {
  makeListRepositoryTreeHandler,
} from "../src/tools/list-repository-tree.js";
import { captureStderr, installFetchMock, type QueuedResponse } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

function entry(name: string, type: "blob" | "tree" = "blob", path = name) {
  return {
    id: `id-${name}`,
    name,
    type,
    path,
    mode: type === "tree" ? "040000" : "100644",
  };
}

function pageOf(count: number, prefix: string): QueuedResponse {
  const entries = Array.from({ length: count }, (_, i) =>
    entry(`${prefix}-${i}`),
  );
  return { ok: true, status: 200, body: entries };
}

describe("list_repository_tree — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("forwards ref, recursive, per_page, page and (optionally) path as query params", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [entry("README.md")] },
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    await handler({
      project_id: 236,
      path: "src/components",
      ref: "main",
      recursive: true,
      per_page: 50,
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/236/repository/tree?` +
        `ref=main&recursive=true&per_page=50&page=1&path=src%2Fcomponents`,
    );
  });

  it("omits the path query param when path is empty / not provided", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [entry("README.md")] },
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    await handler({ project_id: 236 });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).not.toMatch(/[?&]path=/);
    expect(url).toMatch(/[?&]ref=HEAD/);
    expect(url).toMatch(/[?&]recursive=false/);
    expect(url).toMatch(/[?&]per_page=100/);
    expect(url).toMatch(/[?&]page=1/);
  });

  it("path-style project_id is URL-encoded", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    await handler({ project_id: "jakota/support" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url.startsWith(`${BASE_URL}/projects/jakota%2Fsupport/repository/tree?`)).toBe(true);
  });
});

describe("list_repository_tree — pagination", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("stops after the first page when it returns fewer than per_page entries", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [entry("a"), entry("b"), entry("c")] },
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    const result = await handler({ project_id: 236, per_page: 100 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.count).toBe(3);
    expect(json.truncated).toBe(false);
    expect(json.pages_fetched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("continues paging while each page is full, stopping when one is short", async () => {
    const fetchMock = installFetchMock([
      pageOf(10, "p1"), // full → fetch next
      pageOf(10, "p2"), // full → fetch next
      pageOf(3, "p3"), // partial → stop
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    const result = await handler({ project_id: 236, per_page: 10 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.count).toBe(23);
    expect(json.truncated).toBe(false);
    expect(json.pages_fetched).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Verify URLs incremented page=1, 2, 3
    const urls = fetchMock.mock.calls.map(
      (c) => (c as [string, RequestInit])[0],
    );
    expect(urls[0]).toMatch(/[?&]page=1/);
    expect(urls[1]).toMatch(/[?&]page=2/);
    expect(urls[2]).toMatch(/[?&]page=3/);
  });

  it("hits the 5-page hard cap and reports truncated=true", async () => {
    const fetchMock = installFetchMock([
      pageOf(10, "p1"),
      pageOf(10, "p2"),
      pageOf(10, "p3"),
      pageOf(10, "p4"),
      pageOf(10, "p5"), // last page is also FULL → suspect more data
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    const result = await handler({ project_id: 236, per_page: 10 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.count).toBe(50);
    expect(json.truncated).toBe(true);
    expect(json.pages_fetched).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("emits [TRUNCATE] to stderr when the 5-page cap is hit", async () => {
    installFetchMock([
      pageOf(10, "p1"),
      pageOf(10, "p2"),
      pageOf(10, "p3"),
      pageOf(10, "p4"),
      pageOf(10, "p5"),
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    await handler({ project_id: 236, per_page: 10 });
    expect(stderr.text()).toMatch(
      /^\[TRUNCATE\] tool=list_repository_tree .* limit=50 .* pages_fetched=5/m,
    );
  });

  it("does NOT log [TRUNCATE] when result fits in 5 pages", async () => {
    installFetchMock([pageOf(10, "p1"), pageOf(5, "p2")]);
    const handler = makeListRepositoryTreeHandler(newClient());
    await handler({ project_id: 236, per_page: 10 });
    expect(stderr.text()).not.toContain("[TRUNCATE]");
  });

  it("a 5th page that is exactly per_page is treated as truncated (we cannot tell if more exists)", async () => {
    installFetchMock([
      pageOf(10, "p1"),
      pageOf(10, "p2"),
      pageOf(10, "p3"),
      pageOf(10, "p4"),
      pageOf(10, "p5"), // exactly per_page on the cap page
    ]);
    const handler = makeListRepositoryTreeHandler(newClient());
    const result = await handler({ project_id: 236, per_page: 10 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.truncated).toBe(true);
  });
});

describe("list_repository_tree — output shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("returns entries with the spec'd 5 fields and nothing extra", async () => {
    const fullEntry = {
      ...entry("README.md"),
      // GitLab includes other fields we should drop:
      project_id: 999,
      something_else: "drop me",
    };
    installFetchMock([{ ok: true, status: 200, body: [fullEntry] }]);
    const handler = makeListRepositoryTreeHandler(newClient());
    const result = await handler({ project_id: 236 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.entries[0]).toEqual({
      id: "id-README.md",
      name: "README.md",
      type: "blob",
      path: "README.md",
      mode: "100644",
    });
    expect(json.entries[0]).not.toHaveProperty("project_id");
    expect(json.entries[0]).not.toHaveProperty("something_else");
  });
});
