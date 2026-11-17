#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { GitlabClient } from "./gitlab-client.js";
import { isHttpTransport, loadHttpOptions, startHttpServer } from "./http.js";
import { createServer, SERVER_NAME, type ServerDeps } from "./server.js";

const DEFAULT_HTTP_PORT = 8701;

async function main(): Promise<void> {
  const config = loadConfig();
  // Validate transport settings before any network call, so a typo fails fast.
  const http = isHttpTransport() ? loadHttpOptions(process.env, DEFAULT_HTTP_PORT) : undefined;

  const client = new GitlabClient(config.gitlabUrl, config.gitlabToken);

  // Resolve the current user once so list_my_merge_requests can filter by
  // reviewer_username. In HTTP mode this also stays the one /user call per
  // process rather than one per request.
  const me = await client.getCurrentUser();
  const deps: ServerDeps = { client, config, username: me.username };

  if (http) {
    await startHttpServer(SERVER_NAME, () => createServer(deps), http);
    process.stderr.write(
      `[${SERVER_NAME}] listening on http://${http.host}:${http.port}/mcp as @${me.username}` +
        `${http.token ? "" : " (no MCP_HTTP_TOKEN: loopback only)"}\n`,
    );
    return;
  }

  await createServer(deps).connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(
    `[${SERVER_NAME}] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
