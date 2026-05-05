# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A stdio MCP server (`@modelcontextprotocol/sdk` 1.29+) that exposes a GitLab instance (hosted gitlab.com or self-hosted) to LLM clients. Authenticates via `GITLAB_TOKEN` env var, sent on every request as the `PRIVATE-TOKEN` header. No HTTP listener — the process speaks JSON-RPC over stdin/stdout and writes nothing to stdout until a client connects (logs go to stderr).

21 tools across four categories: issue/MR read, time tracking, write actions (gated behind `GITLAB_ENABLE_WRITES=true`), and code-aware reads (file/tree/diff/search/CI logs). Full inventory in `README.md`.

## Commands

```bash
npm run dev          # tsx, no build step, reads .env if shell exports it
npm run typecheck    # tsc --noEmit
npm run build        # tsc → dist/
npm start            # node dist/index.js
npm test             # vitest, mocked-fetch unit tests (no live API calls)
```

## Runtime requirement

Node **20+** is required (uses native `fetch`, and the SDK's peer chain requires ≥18). If your shell defaults to a lower version, switch with nvm before `npm run dev` / `npm test` or you'll hit `EBADENGINE` warnings and the `crypto.getRandomValues` crash from vitest.

## Architecture

Four-layer boundary, kept deliberately thin:

1. **`src/config.ts`** — single `loadConfig()` reads env vars, validates `GITLAB_TOKEN`, returns a `ServerConfig`. Defaults: `GITLAB_URL=https://gitlab.com/api/v4`, `DEFAULT_PROJECT_IDS=[]`, `ACTIONABLE_STATUSES=["To do","In progress"]`. Tools should pull instance-specific defaults from config rather than hardcoding.
2. **`src/gitlab-client.ts`** — `GitlabClient` wraps `fetch` with private `request<T>()`, `requestRaw()` (for non-JSON bodies — file content, job logs), `requestWrite<T>()` (state-mutating endpoints; emits `[WRITE]` to stderr unconditionally), and `graphql<T>()` (used by `fetchWorkItemStatuses`). All HTTP errors become `GitlabError` with status, URL, and parsed body; messages are crafted per status (401 / 403 / 404 / 429 with `Retry-After` / 5xx / network). Add new GitLab calls as typed methods on this class — do not call `fetch` from tool files.
3. **`src/tools/<tool-name>.ts`** — one file per MCP tool. Each exports: a zod **raw shape** object (`{ field: z.string()... }`, *not* `z.object(...)` — that's what `registerTool`'s `inputSchema` expects), a `<tool>Tool` descriptor with `name` and `config`, and a `make<Tool>Handler(client, ...)` factory. Handlers return `{ content: [{ type: "text", text }] }`; throwing is fine — `index.ts` catches and converts to `{ isError: true, content: [...] }`.
4. **`src/index.ts`** — wires it all together: load config → construct client → `new McpServer(...)` → `registerTool` per tool → `connect(new StdioServerTransport())`. Adding a tool = one new file in `src/tools/` + one `registerTool` block here.

## Stderr paper trails (always-on, regardless of any DEBUG flag)

- `[WRITE] METHOD URL payload={...}` — every state-mutating call (writes layer + time tracking).
- `[TRUNCATE] tool=… original_bytes=N returned_bytes=M limit=L key="value"…` — file content, repository tree, MR diff, job log when output is clamped.

Both are intentional: the diagnostic info that would matter "later" when something looks off.

## Tool description convention

Tool descriptions are written for an LLM that has never seen GitLab. The pattern (see `src/tools/list-my-issues.ts`):

- One-line summary of what it does and where it queries (whole instance vs. specific project).
- An explicit **"Use this when..."** list of user phrasings that should trigger it.
- An explicit **"Do NOT use this for..."** list pointing at the right alternative tool.
- The shape of the returned data — including what is *intentionally omitted* and which other tool fetches the omitted bits.
- Default behavior when an arg is omitted (e.g. `state` defaults to `opened`).

Sloppy descriptions are why MCP tools get called wrong. Keep this discipline.

## GraphQL gotchas

The status-fetching path uses GraphQL. Two pitfalls hit before:

1. **`Project.workItems(iids:)` expects `[String!]`, not `[ID!]`** — even though `iids` looks id-shaped. iids are per-project numbers (separate from global gids). `Project.fullPath` is `ID!`. Match each argument exactly; don't standardize the whole query on one type.
2. **Real GitLab time-tracking system notes append `HH:MM:SS ±tz` after the date** (`"added 4h of time spent at 2026-04-24 12:00:00 +0200"`), not just `YYYY-MM-DD` as the docs imply. The parser regex must tolerate the trailing suffix — see `src/time-notes.ts`.

Pinned regression tests cover both.

## Working style for this repo

When asked to add several tools/features at once, ship the first one fully (typecheck + build clean), then **stop and let the user test** before doing the rest. Wording, error shape, and output format almost always need a round of feedback after the first tool — replicating mistakes N× is the failure mode to avoid.

State-mutating tools should NOT exercise the live API in tests by default. Cover the gate (writes-disabled error path) and the request-shape mock; let the user exercise the live mutation organically when a real situation calls for it.

## Codacy instructions

`.github/instructions/codacy.instructions.md` is gitignored on purpose at the user's request. Do not treat it as project-wide guidance and do not invoke Codacy MCP tools from this repo unless the user explicitly asks.
