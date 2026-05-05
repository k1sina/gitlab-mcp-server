import { afterEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeSearchCodeHandler } from "../src/tools/search-code.js";
import { installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

const SAMPLE_MATCH = {
  basename: "Button",
  data: "  return <button onClick={onClick}>{label}</button>;\n",
  path: "src/components/Button.tsx",
  filename: "src/components/Button.tsx",
  id: null,
  ref: "main",
  startline: 17,
  project_id: 89,
};

describe("search_code — project-scoped", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hits /projects/:id/search?scope=blobs&search=… and forwards per_page", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [SAMPLE_MATCH] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    await handler({
      project_id: 89,
      query: "onClick",
      limit: 50,
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/89/search?scope=blobs&search=onClick&per_page=50`,
    );
  });

  it("forwards ref as a query param when provided", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [SAMPLE_MATCH] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    await handler({
      project_id: 89,
      query: "TODO",
      ref: "develop",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/89/search?scope=blobs&search=TODO&per_page=30&ref=develop`,
    );
  });

  it("does NOT send ref when omitted (lets GitLab use the project default branch)", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [SAMPLE_MATCH] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    await handler({ project_id: 89, query: "x" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).not.toMatch(/[?&]ref=/);
  });

  it("URL-encodes a path-style project_id", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    await handler({ project_id: "jakota/group/repo", query: "x" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url.startsWith(`${BASE_URL}/projects/jakota%2Fgroup%2Frepo/search?`)).toBe(
      true,
    );
  });

  it("URL-encodes a query containing reserved characters", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    await handler({
      project_id: 89,
      query: "a&b c=d",
    });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/89/search?scope=blobs&search=a%26b+c%3Dd&per_page=30`,
    );
  });
});

describe("search_code — global", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hits /search?scope=blobs (NOT /projects/:id/search) when project_id is omitted", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [SAMPLE_MATCH] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    await handler({ query: "parseTimeNote" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/search?scope=blobs&search=parseTimeNote&per_page=30`,
    );
    expect(url).not.toMatch(/\/projects\//);
  });

  it("forwards limit as per_page", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    await handler({ query: "foo", limit: 10 });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toMatch(/[?&]per_page=10/);
  });

  it("ignores `ref` for global mode (it's project-scoped only)", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeSearchCodeHandler(newClient());
    // Caller may pass ref by mistake; tool just doesn't forward it for global.
    await handler({ query: "foo", ref: "develop" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).not.toMatch(/[?&]ref=/);
  });
});

describe("search_code — output shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns scope='project' when project_id is set", async () => {
    installFetchMock([{ ok: true, status: 200, body: [SAMPLE_MATCH] }]);
    const handler = makeSearchCodeHandler(newClient());
    const result = await handler({ project_id: 89, query: "x" });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.scope).toBe("project");
  });

  it("returns scope='global' when project_id is omitted", async () => {
    installFetchMock([{ ok: true, status: 200, body: [SAMPLE_MATCH] }]);
    const handler = makeSearchCodeHandler(newClient());
    const result = await handler({ query: "x" });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.scope).toBe("global");
  });

  it("each match contains the spec'd 5 fields and nothing else", async () => {
    installFetchMock([{ ok: true, status: 200, body: [SAMPLE_MATCH] }]);
    const handler = makeSearchCodeHandler(newClient());
    const result = await handler({ project_id: 89, query: "x" });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.matches[0]).toEqual({
      project_id: 89,
      path: "src/components/Button.tsx",
      ref: "main",
      startline: 17,
      data: "  return <button onClick={onClick}>{label}</button>;\n",
    });
    expect(json.matches[0]).not.toHaveProperty("basename");
    expect(json.matches[0]).not.toHaveProperty("filename");
    expect(json.matches[0]).not.toHaveProperty("id");
  });

  it("returns count=0 and an empty matches array when GitLab returns []", async () => {
    installFetchMock([{ ok: true, status: 200, body: [] }]);
    const handler = makeSearchCodeHandler(newClient());
    const result = await handler({ query: "needle-not-in-haystack" });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.count).toBe(0);
    expect(json.matches).toEqual([]);
  });

  it("echoes the query verbatim in the response envelope", async () => {
    installFetchMock([{ ok: true, status: 200, body: [SAMPLE_MATCH] }]);
    const handler = makeSearchCodeHandler(newClient());
    const result = await handler({ query: "useState" });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.query).toBe("useState");
  });
});

describe("search_code — input validation", () => {
  it("rejects empty query at the schema layer", async () => {
    const { z } = await import("zod");
    const { searchCodeInputShape } = await import(
      "../src/tools/search-code.js"
    );
    const schema = z.object(searchCodeInputShape);
    expect(() => schema.parse({ query: "" })).toThrow();
    expect(() => schema.parse({ query: "   " })).toThrow();
    expect(() => schema.parse({ query: "x" })).not.toThrow();
  });
});
