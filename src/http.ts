/**
 * Opt-in Streamable HTTP transport, selected with `MCP_TRANSPORT=http`.
 * stdio stays the default, so local clients keep working unchanged.
 *
 * Stateless: every `POST /mcp` gets a fresh McpServer and transport, so a
 * restart loses nothing and concurrent clients cannot see each other's state.
 * Responses are plain JSON rather than SSE: no tool here streams progress, and
 * JSON passes through any reverse proxy without buffering surprises.
 *
 * Auth has two modes:
 * - `MCP_HTTP_TOKEN` set: every `/mcp` request must send
 *   `Authorization: Bearer <token>`. The public gateway authenticates the
 *   caller and forwards with this token, so a listener that ends up reachable
 *   by mistake still refuses strangers.
 * - No token: the listener refuses to bind anywhere but loopback, and answers
 *   only requests whose Host header names loopback. That stops a web page in a
 *   local browser from reaching it through DNS rebinding.
 *
 * This file is self-contained and shared verbatim across the MCP servers that
 * run behind the gateway. Keep it free of server-specific imports.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface HttpOptions {
  host: string;
  port: number;
  token: string | undefined;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const MIN_TOKEN_LENGTH = 32;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MCP_PATH = "/mcp";
const HEALTH_PATH = "/healthz";

/** True when `MCP_TRANSPORT=http`; false for unset, empty, or `stdio`. */
export function isHttpTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.MCP_TRANSPORT ?? "").trim().toLowerCase();
  if (raw === "" || raw === "stdio") return false;
  if (raw === "http") return true;
  throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got: ${env.MCP_TRANSPORT}`);
}

export function loadHttpOptions(
  env: NodeJS.ProcessEnv = process.env,
  defaultPort: number,
): HttpOptions {
  const host = env.MCP_HTTP_HOST?.trim() || "127.0.0.1";

  const rawPort = env.MCP_HTTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : defaultPort;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`MCP_HTTP_PORT must be an integer between 0 and 65535, got: ${rawPort}`);
  }

  const token = env.MCP_HTTP_TOKEN?.trim() || undefined;
  if (token !== undefined && token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `MCP_HTTP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters. Generate one with: openssl rand -hex 32`,
    );
  }
  if (token === undefined && !LOOPBACK_HOSTNAMES.has(stripBrackets(host))) {
    throw new Error(
      `MCP_HTTP_HOST=${host} is not a loopback address. Set MCP_HTTP_TOKEN, or anyone who can reach this port can call every tool.`,
    );
  }

  return { host, port, token };
}

/**
 * Listen for MCP over Streamable HTTP. `factory` is called once per request
 * and must return a new, fully registered McpServer each time.
 */
export async function startHttpServer(
  name: string,
  factory: () => McpServer,
  opts: HttpOptions,
): Promise<Server> {
  const server = createHttpServer((req, res) => {
    handle(req, res, factory, opts).catch((err: unknown) => {
      process.stderr.write(`[${name}] http: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  factory: () => McpServer,
  opts: HttpOptions,
): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (path === HEALTH_PATH) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (path !== MCP_PATH) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (opts.token !== undefined) {
    if (!bearerMatches(req.headers.authorization, opts.token)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      sendJsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }
  } else if (!isLoopbackHostHeader(req.headers.host)) {
    sendJsonRpcError(res, 403, -32001, "Forbidden: Host header must name loopback");
    return;
  }

  // Stateless: there is no session to stream to (GET) or end (DELETE).
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJsonRpcError(res, 405, -32000, "Method not allowed");
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      sendJsonRpcError(res, 413, -32600, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
    } else {
      sendJsonRpcError(res, 400, -32700, "Parse error: body is not valid JSON");
    }
    return;
  }

  const mcp = factory();
  // No sessionIdGenerator: that is what makes the transport stateless.
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  // The cast bridges the SDK's own optional-callback typings, which disagree
  // under exactOptionalPropertyTypes; the runtime shapes are identical.
  await mcp.connect(transport as Transport);
  await transport.handleRequest(req, res, body);
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  const presented = header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (presented === undefined) return false;
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(stripBrackets(new URL(`http://${hostHeader}`).hostname));
  } catch {
    return false;
  }
}

function stripBrackets(host: string): string {
  return host.replace(/^\[(.*)\]$/, "$1");
}

class BodyTooLargeError extends Error {}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
}

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}
