import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { GitlabClient } from "../src/gitlab-client.js";
import { isHttpTransport, loadHttpOptions, startHttpServer } from "../src/http.js";
import { createServer } from "../src/server.js";

const TOKEN = "a".repeat(64);

let server: Server | undefined;

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

/** The real tool registry; nothing here reaches GitLab, so no fetch mock is needed. */
function factory() {
  const config = loadConfig({ GITLAB_TOKEN: "glpat-test", GITLAB_URL: "https://gitlab.invalid/api/v4" });
  return createServer({
    client: new GitlabClient(config.gitlabUrl, config.gitlabToken),
    config,
    username: "tester",
  });
}

async function start(token?: string): Promise<string> {
  server = await startHttpServer("test", factory, { host: "127.0.0.1", port: 0, token });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function connect(base: string, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: "http-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  return client;
}

/** Raw request, for headers fetch refuses to set (Host) and non-MCP routes. */
function raw(
  base: string,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const url = new URL(opts.path ?? "/mcp", base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: opts.method ?? "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...opts.headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "raw", version: "0" },
  },
});

describe("isHttpTransport", () => {
  it("defaults to stdio", () => {
    expect(isHttpTransport({})).toBe(false);
    expect(isHttpTransport({ MCP_TRANSPORT: "" })).toBe(false);
    expect(isHttpTransport({ MCP_TRANSPORT: "stdio" })).toBe(false);
  });
  it("accepts http case-insensitively", () => {
    expect(isHttpTransport({ MCP_TRANSPORT: "HTTP" })).toBe(true);
  });
  it("rejects anything else rather than silently using stdio", () => {
    expect(() => isHttpTransport({ MCP_TRANSPORT: "sse" })).toThrow(/stdio" or "http/);
  });
});

describe("loadHttpOptions", () => {
  it("defaults to loopback on the given port with no token", () => {
    expect(loadHttpOptions({}, 8701)).toEqual({ host: "127.0.0.1", port: 8701, token: undefined });
  });
  it("reads host, port and token", () => {
    expect(
      loadHttpOptions({ MCP_HTTP_HOST: "0.0.0.0", MCP_HTTP_PORT: "9000", MCP_HTTP_TOKEN: TOKEN }, 8701),
    ).toEqual({ host: "0.0.0.0", port: 9000, token: TOKEN });
  });
  it("refuses a non-loopback host without a token", () => {
    expect(() => loadHttpOptions({ MCP_HTTP_HOST: "0.0.0.0" }, 8701)).toThrow(/not a loopback/);
  });
  it("accepts bracketed IPv6 loopback without a token", () => {
    expect(loadHttpOptions({ MCP_HTTP_HOST: "[::1]" }, 8701).host).toBe("[::1]");
  });
  it("refuses a short token", () => {
    expect(() => loadHttpOptions({ MCP_HTTP_TOKEN: "short" }, 8701)).toThrow(/at least 32/);
  });
  it("refuses a bad port", () => {
    expect(() => loadHttpOptions({ MCP_HTTP_PORT: "http" }, 8701)).toThrow(/MCP_HTTP_PORT/);
    expect(() => loadHttpOptions({ MCP_HTTP_PORT: "70000" }, 8701)).toThrow(/MCP_HTTP_PORT/);
  });
});

describe("HTTP transport with a token", () => {
  it("lists every tool and runs a tool call end to end", async () => {
    const base = await start(TOKEN);
    const client = await connect(base, { Authorization: `Bearer ${TOKEN}` });

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(24);
    expect(tools.map((t) => t.name)).toContain("get_issue");

    // Writes are off in this config, so the gate answers without touching GitLab.
    const result = await client.callTool({
      name: "comment_on_issue",
      arguments: { project_id: 1, issue_iid: 1, body: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/Writes are disabled/);

    await client.close();
  });

  it("serves concurrent requests, each with its own server", async () => {
    const base = await start(TOKEN);
    const clients = await Promise.all(
      [1, 2, 3].map(() => connect(base, { Authorization: `Bearer ${TOKEN}` })),
    );
    const lists = await Promise.all(clients.map((c) => c.listTools()));
    expect(lists.map((l) => l.tools.length)).toEqual([24, 24, 24]);
    await Promise.all(clients.map((c) => c.close()));
  });

  it("rejects a missing token with 401 and a Bearer challenge", async () => {
    const base = await start(TOKEN);
    const res = await raw(base, { body: INIT });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
  });

  it("rejects a wrong token", async () => {
    const base = await start(TOKEN);
    const res = await raw(base, { body: INIT, headers: { authorization: `Bearer ${"b".repeat(64)}` } });
    expect(res.status).toBe(401);
  });

  it("does not check Host once a token is required", async () => {
    const base = await start(TOKEN);
    const res = await raw(base, {
      body: INIT,
      headers: { host: "mcp.example.com", authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("HTTP transport without a token", () => {
  it("works for loopback clients", async () => {
    const base = await start();
    const client = await connect(base);
    expect((await client.listTools()).tools).toHaveLength(24);
    await client.close();
  });

  it("rejects a Host header that is not loopback (DNS rebinding)", async () => {
    const base = await start();
    const res = await raw(base, { body: INIT, headers: { host: "evil.example:8701" } });
    expect(res.status).toBe(403);
  });
});

describe("HTTP routing", () => {
  it("answers /healthz without auth", async () => {
    const base = await start(TOKEN);
    const res = await raw(base, { method: "GET", path: "/healthz" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("returns 404 for other paths", async () => {
    const base = await start(TOKEN);
    expect((await raw(base, { method: "GET", path: "/" })).status).toBe(404);
  });

  it("returns 405 for GET and DELETE on /mcp (stateless: no stream, no session)", async () => {
    const base = await start(TOKEN);
    const auth = { authorization: `Bearer ${TOKEN}` };
    for (const method of ["GET", "DELETE"]) {
      const res = await raw(base, { method, headers: auth });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("POST");
    }
  });

  it("returns a JSON-RPC parse error for a body that is not JSON", async () => {
    const base = await start(TOKEN);
    const res = await raw(base, { body: "{nope", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });
});
