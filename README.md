# gitlab-mcp-server

An MCP server that exposes a GitLab instance (gitlab.com or self-hosted) to LLM clients (Claude Desktop, Claude Code, etc.) over **stdio**. Configure with one env var (`GITLAB_TOKEN`); point at any instance via `GITLAB_URL`.

> **Status:** v0.7 — 21 tools across four categories: 6 issue/MR read (`list_my_issues`, `list_my_merge_requests`, `get_issue`, `get_merge_request`, `list_project_pipelines`, `search_projects`), 4 time-tracking (`log_time`, `get_time`, `delete_time`, `report_time`), 5 write (`comment_on_issue`, `comment_on_mr`, `create_issue`, `update_issue`, `update_merge_request`), and 6 code-aware read (`get_file_content`, `list_repository_tree`, `get_mr_diff`, `search_code`, `get_pipeline_jobs`, `get_job_log`). `list_my_issues` is **actionable-by-default** (filters by GitLab Work Item Status — names configurable via env). All state-mutating tools are gated behind `GITLAB_ENABLE_WRITES=true`.

## Requirements

- Node.js **20+** (uses native `fetch`)
- A GitLab personal access token with the `api` scope, generated at `https://<your-gitlab-host>/-/user_settings/personal_access_tokens` (e.g. [https://gitlab.com/-/user_settings/personal_access_tokens](https://gitlab.com/-/user_settings/personal_access_tokens) for hosted).

## Setup

```bash
npm install
cp .env.example .env   # then fill in GITLAB_TOKEN
npm run build
```

### Environment variables

| Variable              | Required | Default                       | Notes                                                                                                                                                                                                                                |
| --------------------- | -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GITLAB_TOKEN`        | yes      | —                             | Personal access token, `api` scope.                                                                                                                                                                                                  |
| `GITLAB_URL`          | no       | `https://gitlab.com/api/v4`   | API base URL, no trailing slash. Set to your self-hosted instance, e.g. `https://gitlab.example.com/api/v4`.                                                                                                                         |
| `DEFAULT_PROJECT_IDS` | no       | (none)                        | Comma-separated numeric project IDs that future aggregate tools will treat as the user's default project set. Currently unused; safe to leave unset.                                                                                 |
| `ACTIONABLE_STATUSES` | no       | `To do,In progress`           | Comma-separated GitLab Work Item Status names that `list_my_issues` keeps by default. GitLab's stock workflow uses these names. Override if your instance has renamed them. Set to empty string to disable the default filter.        |
| `GITLAB_ENABLE_WRITES`| no       | (disabled)                    | Set to `1`/`true`/`yes` to enable the five write tools and the two state-mutating time tools. Disabled by default so a misrouted tool call cannot mutate GitLab state.                                                                |

## Develop

```bash
npm run dev          # tsx, hot path; reads .env if your shell exports it
npm run typecheck
npm run build        # emits dist/
npm start            # runs dist/index.js
npm test             # vitest, mocked-fetch unit tests for all write tools
```

**Node-version gotcha:** if your shell defaults to Node < 18, `npx vitest` will crash with `crypto.getRandomValues is not a function`. Either switch via nvm (`nvm use 20`) or invoke vitest directly: `node ./node_modules/vitest/vitest.mjs run`.

The server speaks MCP over stdio — it has no HTTP listener and produces no stdout output until a client connects.

## Tools (v0.7)

### `list_my_issues`

Lists GitLab issues assigned to the authenticated user across the entire configured instance. **Actionable-by-default** — only tickets whose Work Item Status matches `ACTIONABLE_STATUSES` (default `"To do" / "In progress"`) are returned unless the caller widens the filter.

- `state` (optional): `"opened" | "closed" | "all"` — default `"opened"`.
- `status` (optional, string array): Work Item Status names to keep. When omitted, uses the server-configured `ACTIONABLE_STATUSES`. Pass `[]` to disable the filter and see every status. Setting `state` to `"closed"` or `"all"` also drops the default (audit views shouldn't be triaged).
- `limit` (optional): integer 1–100 — default 50.

Output: `{ count, applied_status_filter, issues: [{ ..., status: { name, color } | null, ... }] }`. Each issue carries its current `status` (or `null` for projects that don't use the field). Issues without a status are **always** included regardless of the filter, so you don't lose visibility on tickets in projects that haven't adopted the workflow widget. Description and comments are intentionally omitted — call `get_issue` for those.

**How it works:** the status field is GitLab's first-class `WorkItemWidgetStatus` widget (not a label). The REST `/issues` response doesn't carry it, so the tool fires one batched GraphQL request after the REST list to attach status to each issue, then filters client-side. When the filter is disabled (`status: []` or `state: "closed"`/`"all"`), the GraphQL call is skipped entirely.

### `list_my_merge_requests`

Lists MRs where the authenticated user is the assignee OR a requested reviewer. Two underlying GitLab queries are run in parallel and deduplicated by id.

- `state` (optional): `"opened" | "closed" | "merged" | "all"` — default `"opened"`.
- `limit` (optional): integer 1–100 — default 50 (applied after dedup).

Output: `{ count, merge_requests: [...] }`. Each MR has a `my_role` field — `"assignee"`, `"reviewer"`, or `"both"` — for triage. Description, diffs, and comments are omitted — call `get_merge_request` for those.

The current user is resolved once at server startup via `GET /user`, so reviewer filtering doesn't need a per-call lookup.

### `get_issue`

Full issue body, workflow status, and discussion.

- `project_id`: numeric id (preferred) or `"group/repo"` path.
- `issue_iid`: per-project number from the URL (`/-/issues/42` → `42`).
- `include_notes` (optional, default `true`): fetch comments.
- `include_system_notes` (optional, default `false`): include GitLab's bookkeeping notes (label changes, mentions, etc).

Output: `{ issue: { ..., status: { name, color } | null, ... }, notes: [...] | null }`. The `status` field reflects the GitLab Work Item Status widget (e.g. `"To do"`, `"In progress"`); it is `null` for tickets in projects that don't use the field, or when the GraphQL fetch fails (degrades gracefully — the issue body and notes still come back).

### `get_merge_request`

Full MR body, optional diffs, and discussion.

- `project_id`: numeric id (preferred) or `"group/repo"` path.
- `mr_iid`: per-project number from the URL (`/-/merge_requests/17` → `17`).
- `include_diffs` (optional, default `false`): fetch the file changes from `/changes`. **Off by default — diffs can be very large.**
- `include_notes` (optional, default `true`): fetch comments.
- `include_system_notes` (optional, default `false`): include bookkeeping notes.

Output: `{ merge_request: {...}, changes: { files: [...] } | null, notes: [...] | null }`.

### `list_project_pipelines`

Most recent CI pipelines for a single project, newest first.

- `project_id`: numeric id (preferred) or `"group/repo"` path.
- `limit` (optional, default 20): integer 1–100.

Output: `{ count, pipelines: [...] }`. Each entry has `status`, `source` (push / schedule / merge_request_event / web / ...), `ref`, full `sha`, `sha_short`, `web_url`, and timestamps. Job-level details and durations are not included.

A 403 from this tool usually means CI is disabled for that project, not a token problem.

### `search_projects`

Find projects by name or path — used to discover the `project_id` you need before calling other project-scoped tools.

- `query`: free-text, matched against project name / path / namespace.
- `limit` (optional, default 20): integer 1–100.

Results are ordered by `last_activity_at` desc. Output: `{ count, projects: [...] }`. Each project has `id`, `path_with_namespace`, `name`, `description`, `default_branch`, `visibility`, `archived`, `web_url`, `last_activity_at`, `star_count`, `forks_count`.

### Time-tracking tools

All four take a `target_type` of `"issue"` or `"merge_request"` plus `project_id` and `iid`. Durations use GitLab's format: combine `w` (week=5d), `d` (day=8h), `h`, `m`, `s` — e.g. `30m`, `1h30m`, `2h`, `1w 2d`.

#### `get_time` (read-only)

Cumulative time totals on an issue or MR — across **all users**, not just the current one. Output: `{ time_estimate_seconds, total_time_spent_seconds, human_*, over_estimate }`.

#### `log_time` (write — requires `GITLAB_ENABLE_WRITES=true`)

Append spent time. Inputs: `target_type`, `project_id`, `iid`, `duration` (positive), optional `summary`, optional `date_time` (YYYY-MM-DD or ISO) for backdating. Returns the updated stats.

#### `delete_time` (write — requires `GITLAB_ENABLE_WRITES=true`)

Subtract a duration from cumulative spent time — used to correct over-logging. Pass a **positive** value; the tool prepends the minus sign internally. There is no per-entry delete in GitLab's API; this just adjusts the running total. Use the GitLab UI's "remove time spent" button for a full reset (deliberately not exposed here).

#### `report_time` (read-only)

Daily timesheet of time **you** logged across issues and MRs in a date range. Optional `from`/`to` (YYYY-MM-DD); default last 7 days inclusive of today.

Output:

```json
{
  "range": { "from": "2026-04-21", "to": "2026-04-28" },
  "grand_total_seconds": 81000,
  "grand_total_human": "22h 30m",
  "days": [
    {
      "date": "2026-04-28",
      "total_seconds": 12600,
      "total_human": "3h 30m",
      "entries": [
        { "target_type": "issue", "project_id": 236, "iid": 355, "title": "...",
          "web_url": "...", "duration_seconds": 5400, "duration_human": "1h 30m",
          "logged_at": "2026-04-28T09:14:00Z" }
      ]
    }
  ]
}
```

**Limitation:** scans only issues/MRs you are assigned to or authored. Time you logged on someone else's ticket where you are neither will be missed. Built by parsing GitLab's `added/subtracted X of time spent at YYYY-MM-DD` system notes — there is no REST endpoint for individual time entries.

### Write tools

> ⚠️ **These tools mutate live GitLab state.** They post comments, create issues, change titles/descriptions/labels/assignees/state, and toggle MR draft status. Every call is logged to stderr with a `[WRITE]` prefix as a paper trail, regardless of any DEBUG flag. All write tools are **disabled by default** and require `GITLAB_ENABLE_WRITES=true` on the MCP server.
>
> GitLab does **not** deduplicate writes — calling a comment or create tool twice produces two records. If a call returns an error, do not blindly retry; verify state first.

Every write tool's description starts with `WRITES TO GITLAB:` so the client (Claude Desktop, etc.) can surface the action clearly to the user before the call.

#### `comment_on_issue`

Posts a markdown comment on an existing issue.

- `project_id`, `issue_iid`, `body` (markdown, non-empty / non-whitespace).
- Returns the created note.
- Example user prompt: *"Comment on issue 42 in project 17: 'Verified on staging — looks good.'"*

#### `comment_on_mr`

Posts a markdown comment on an existing merge request. (Not a line/diff review comment — that's a different endpoint, not implemented.)

- `project_id`, `mr_iid`, `body`.
- Returns the created note.
- Example: *"Reply on MR 17 in project 89: 'LGTM, merging once CI passes.'"*

#### `create_issue`

Files a new issue.

- Required: `project_id`, `title`.
- Optional: `description`, `labels` (string[] — comma-joined on the wire), `assignee_ids` (numeric, NOT usernames), `milestone_id`, `confidential`.
- Returns the full created issue.
- Example: *"Open a new issue in project 17 titled 'Login broken on Safari', label it bug, assign to user 50."*

#### `update_issue`

Updates fields on an existing issue.

- Required: `project_id`, `issue_iid`.
- Optional: `title`, `description`, `assignee_ids`, `milestone_id`, `state_event` (`"close" | "reopen"`).
- **Labels — three modes, mutually exclusive:**
  - `labels` (string[]) — full replace; `[]` clears all.
  - `add_labels` / `remove_labels` (string[]) — incremental.
  - Passing `labels` together with `add_labels` or `remove_labels` is rejected as ambiguous (zod refinement; never reaches GitLab).
- `assignee_ids: []` or `[0]` unassigns everyone. `milestone_id: 0` clears the milestone. (GitLab's documented sentinels.)
- Returns the updated issue.
- Example: *"On issue 42 in project 17, add label 'in-review' and remove 'wip', then close it."*

#### `update_merge_request`

Updates fields on an existing MR. Same shape as `update_issue` plus `reviewer_ids` and `draft`.

- Required: `project_id`, `mr_iid`.
- Optional: everything from `update_issue` (with `mr_iid` instead of `issue_iid`), plus:
  - `reviewer_ids` (number[]) — replace requested reviewers; `[]` or `[0]` clears.
  - `draft` (boolean) — toggle the Draft / WIP flag. Prefer this over editing the title prefix.
- `state_event: "close" | "reopen"`. **There is no merge tool here** — merging is intentionally not exposed.
- Same labels-conflict rule as `update_issue`.
- Returns the updated MR.
- Example: *"Mark MR 17 in project 89 as ready (clear Draft) and add user 51 as a reviewer."*

### Code-aware tools

These read source files, MR diffs, and CI logs. All read-only. Tools that may truncate (`get_file_content`, `list_repository_tree`, `get_mr_diff`, `get_job_log`) emit a `[TRUNCATE]` line to stderr with original / returned / limit byte counts whenever they clamp output — separate from `[WRITE]`, on the same always-on paper-trail pattern.

#### `get_file_content`

Reads one file at a specific ref (branch / tag / commit SHA). Refuses binary files (null byte in first 8KB or binary content-type) rather than returning garbage.

- `project_id`, `file_path` (forward-slashed, NOT URL-encoded — the tool encodes), optional `ref` (default `"HEAD"`), optional `max_bytes` (default 200000).
- Returns `{ path, ref, size_bytes, content, truncated }`. `size_bytes` is the original size; truncation appends a clearly-marked notice.
- Example: *"Show me `src/components/Button.tsx` from the develop branch of project 17."*

#### `list_repository_tree`

Lists files and directories at a ref. Paginates up to 5 pages of `per_page` entries (default cap: 500 entries) before stopping with `truncated: true`.

- `project_id`, optional `path` (default `""` = repo root), optional `ref` (default `"HEAD"`), optional `recursive` (default `false`), optional `per_page` (1–100, default 100).
- Returns `{ entries: [{ id, name, type, path, mode }], truncated, pages_fetched, count, ref, path, recursive }`.
- Example: *"What's under `config/` in this repo?"* (drill in via `path` rather than `recursive: true` on a monorepo.)

#### `get_mr_diff`

Purpose-built for code review — fetches the per-file changes only, no MR metadata. Truncates at file boundaries so hunks are never split.

- `project_id`, `mr_iid`, optional `max_total_bytes` (default 80000).
- Returns `{ project_id, mr_iid, files: [{ old_path, new_path, new_file, deleted_file, renamed_file, diff }], truncated, total_diff_bytes, returned_diff_bytes, files_omitted, note }`.
- If a single file's diff exceeds `max_total_bytes`, **zero files** are returned — raise the cap or pivot to `get_file_content` for that file.
- Example: *"Walk me through the diff for MR 17."*

#### `search_code`

Substring search across indexed file content. Project-scoped or instance-wide depending on whether `project_id` is set.

- `query` (required, **substring only — no regex, no glob, case-insensitive**), optional `project_id` (omit for global), optional `ref` (project-scoped only), optional `limit` (1–100, default 30).
- Returns `{ scope: "project" | "global", count, matches: [{ project_id, path, ref, startline, data }] }`. `data` is GitLab's snippet (~3 lines of context); `startline` is the 1-based line number of `data`'s first line.
- **Self-hosted caveat:** GLOBAL blob search requires Elasticsearch indexing on the GitLab instance. Without it, global search returns `[]` or an error; project-scoped search works regardless.
- Example: *"Where is `parseTimeNote` used in this codebase?"*

#### `get_pipeline_jobs`

Drills INTO a single pipeline. Returns its jobs, sorted alphabetically by `(stage, name)` for stable output.

- `project_id`, `pipeline_id` (numeric, from `list_project_pipelines`), optional `scope` (`"failed" | "success" | "running" | "pending" | "canceled" | "skipped" | "manual"`).
- Returns `{ count, jobs: [{ id, name, stage, status, ref, created_at, started_at, finished_at, duration, web_url, failure_reason }] }`.
- Example: *"What failed in pipeline 1234 in project 17?"* (`scope: "failed"`)

#### `get_job_log`

Reads one job's log with ANSI color codes stripped. Issues two parallel calls — one for the log, one for the job's status — so the response includes both.

- `project_id`, `job_id` (numeric, from `get_pipeline_jobs`), optional `max_bytes` (default 100000), optional `tail` (default `true`).
- `tail: true` returns the LAST `max_bytes` (right for debugging — failure is at the end). `tail: false` returns the FIRST `max_bytes` (right for build-setup output). Byte counts are measured AFTER ANSI stripping.
- Returns `{ job_id, status, log, truncated, total_bytes, returned_bytes, tailed }`.
- Example: *"Show me the log for job 12345 — what does the failure say?"*

### Inter-tool guidance

The code-aware tools and the older read tools overlap. Pick the right one to avoid wasted calls.

| If you want to … | Use | NOT |
|---|---|---|
| Discover a file path you don't know | `list_repository_tree` (drill via `path` parameter) | `get_file_content` (will 404 on guesses) |
| Read a file at a known path | `get_file_content` | `list_repository_tree` |
| Search file CONTENT | `search_code` (substring-only, case-insensitive) | `list_repository_tree` (lists files, doesn't read them) |
| Find a project by name | `search_projects` | `search_code` (searches blob content, not project metadata) |
| Review the changes in an MR | `get_mr_diff` (lean, diff-only) | `get_merge_request` with `include_diffs=true` (heavier — also returns description/labels/state) |
| Read an MR description / state / comments | `get_merge_request` | `get_mr_diff` (no metadata) |
| List recent pipelines for a project | `list_project_pipelines` | `get_pipeline_jobs` (drills INTO one pipeline) |
| List jobs in one specific pipeline | `get_pipeline_jobs` | `list_project_pipelines` (no per-job detail) |
| Read a job's failure output | `get_job_log` | `get_pipeline_jobs` (job metadata only, no log) |

**Substring-only matters.** `search_code` does NOT do regex, glob, or fuzzy matching. Pass the shortest distinctive substring of what you're looking for (e.g. `"parseTimeNote"`, not `parseTime.*Note` or `*.Note`). Quotes are not interpreted.

**`HEAD` vs default branch.** The code-aware tools default `ref` to `"HEAD"`, which GitLab resolves to the project's default branch. If you need to read against a feature branch or commit SHA, pass it explicitly.

**Truncation is informative, not silent.** When a tool clamps its output, it sets `truncated: true` AND emits a `[TRUNCATE]` stderr line with original / returned / limit byte counts. If a response feels incomplete, check `truncated` — don't just retry with hope.

## Registering with Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "node",
      "args": ["/absolute/path/to/gitlab-mcp-server/dist/index.js"],
      "env": {
        "GITLAB_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx",
        "GITLAB_URL": "https://gitlab.com/api/v4"
      }
    }
  }
}
```

Replace the path with the absolute path to your built `dist/index.js`, paste your token, and (if you're on a self-hosted instance) override `GITLAB_URL`. Restart Claude Desktop. The `gitlab` server should appear in the MCP servers list and `list_my_issues` should be callable.

For development you can swap `command`/`args` to run via `tsx` without building:

```json
{
  "command": "npx",
  "args": ["tsx", "/absolute/path/to/gitlab-mcp-server/src/index.ts"]
}
```

## Troubleshooting

- **401 on first call:** `GITLAB_TOKEN` is missing, expired, or lacks the `api` scope. Regenerate at the link above.
- **Server not appearing in Claude Desktop:** check the absolute path resolves and that the JSON file is valid; Claude Desktop silently ignores invalid configs. Tail `~/Library/Logs/Claude/mcp*.log` on macOS.
- **Empty results:** confirm the token's user actually has issues assigned by visiting your instance's `/dashboard/issues` page.
- **`list_my_issues` returns far fewer items than expected:** by design — the actionable-by-default filter hides anything outside `ACTIONABLE_STATUSES`. Try `status: []` for the unfiltered list, or override the env var if your instance uses different status names.

## Testing

`tests/` holds vitest mocked-fetch tests. They assert the URL, method, headers, JSON payload shape, `[WRITE]` log emission, writes-disabled gate, structured 4xx error surfacing, and zod input validation for every write tool. **No live API calls.** Run with `npm test`.

The pure-function parser tests for time tracking still live as a node script (`scripts/parser-check.mjs`) since they predate the test runner.

## Roadmap

Likely next steps (not committed):

- A `merge_mr` write tool (deliberately separate from `update_merge_request` because merging has its own knobs: squash, when-pipeline-succeeds, source-branch deletion).
- Inline / line-level diff comments on MRs (`POST /merge_requests/:iid/discussions` with `position` payload — different endpoint than `comment_on_mr`).
- GraphQL-backed `report_time` using `Issue.timelogs` / `MergeRequest.timelogs` — would lift the assigned/authored-only scope and give us per-entry ids for true delete-by-id.
- Aggregate / dashboard tools (Layer 5) that compose the existing tools rather than adding new endpoints.
- Pagination for tools where `limit` capped at 100 isn't enough.
- `DEBUG=1` env for verbose logging on read-side requests (write tools and truncating tools already log unconditionally).
