# Changelog

All notable changes to `gitlab-mcp-server` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added
- `get_attachment`: reads images and files uploaded into issues, MRs, and comments (`/uploads/<secret>/<file>` links). Images come back as MCP image blocks, text inline (truncated at `max_bytes`), PDFs as an embedded resource, and other binaries as metadata only. Requires GitLab 17.4+.
- `get_issue` / `get_merge_request` descriptions now point the model at `get_attachment` for `/uploads/` links.

### Fixed
- Work-item status lookups are split into batches of 3 projects per GraphQL query, so `list_my_issues` across 5+ projects no longer fails with GitLab's "Query has complexity of 305" error.

## 0.7.0 — 2026-05-07

Initial public release. 21 tools across four categories.

### Issue / MR read
- `list_my_issues` — actionable-by-default, filters by GitLab Work Item Status
- `list_my_merge_requests` — assignee OR reviewer, deduped
- `get_issue`, `get_merge_request`
- `list_project_pipelines`, `search_projects`

### Time tracking
- `log_time`, `get_time`, `delete_time`, `report_time`

### Write (gated behind `GITLAB_ENABLE_WRITES=true`)
- `comment_on_issue`, `comment_on_mr`
- `create_issue`, `update_issue`
- `update_merge_request`

### Code-aware read
- `get_file_content`, `list_repository_tree`
- `get_mr_diff`, `search_code`
- `get_pipeline_jobs`, `get_job_log`

### Operational
- `[WRITE]` and `[TRUNCATE]` stderr paper trails are always-on (no DEBUG flag required).
- Configurable via `GITLAB_TOKEN`, `GITLAB_URL`, `DEFAULT_PROJECT_IDS`, `ACTIONABLE_STATUSES`, `GITLAB_ENABLE_WRITES`.
