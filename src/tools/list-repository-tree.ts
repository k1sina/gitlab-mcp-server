import { z } from "zod";
import type { GitlabClient, GitlabTreeEntry } from "../gitlab-client.js";
import { logTruncate } from "../util/log.js";
import { projectIdSchema } from "./shared.js";

export const listRepositoryTreeInputShape = {
  project_id: projectIdSchema,
  path: z
    .string()
    .optional()
    .describe(
      "Subdirectory within the repository (no leading slash). Defaults to '' (the project root). Use this to drill into a folder without recursive=true blowing up the response.",
    ),
  ref: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Branch name, tag name, or commit SHA. Defaults to 'HEAD' (the project's default branch).",
    ),
  recursive: z
    .boolean()
    .optional()
    .describe(
      "Walk into subdirectories. Default false. ON LARGE REPOS, expect this to hit the 5-page (≤500 entries with default per_page=100) cap quickly — prefer non-recursive + drill-down with `path`.",
    ),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Page size (1-100, default 100). The tool fetches up to 5 pages, so this is also a soft cap on total entries returned (5 × per_page).",
    ),
} as const;

const inputSchema = z.object(listRepositoryTreeInputShape);
export type ListRepositoryTreeInput = z.infer<typeof inputSchema>;

export const listRepositoryTreeTool = {
  name: "list_repository_tree",
  config: {
    title: "List files and directories in a GitLab repository",
    description: [
      "List the contents of a repository (or a subdirectory) at a specific ref. READ-ONLY.",
      "",
      "Use this BEFORE get_file_content when you do not already know the exact file path — guessing paths wastes calls. Also use it to answer 'what's in this repo?' / 'is there a config file under config/?' style questions.",
      "Do NOT use this to read file contents (that's get_file_content). Do NOT use this to search file CONTENT — that's search_code.",
      "",
      "Pagination: the tool fetches up to 5 pages of `per_page` entries each (so default 5 × 100 = 500 entries cap). When the cap is hit, `truncated: true` and `pages_fetched: 5` are returned, and a [TRUNCATE] line is logged to stderr. Drill into subdirectories via `path` rather than running recursive on a monorepo.",
      "",
      "Returns: { entries: [{ id, name, type ('blob'|'tree'), path, mode }], truncated, pages_fetched }.",
    ].join("\n"),
    inputSchema: listRepositoryTreeInputShape,
  },
} as const;

export function makeListRepositoryTreeHandler(client: GitlabClient) {
  return async (args: ListRepositoryTreeInput) => {
    const perPage = args.per_page ?? 100;
    const ref = args.ref ?? "HEAD";
    const recursive = args.recursive ?? false;
    const path = args.path ?? "";

    const { entries, truncated, pagesFetched } = await client.listRepositoryTree(
      args.project_id,
      {
        path,
        ref,
        recursive,
        perPage,
      },
    );

    if (truncated) {
      logTruncate({
        tool: "list_repository_tree",
        originalBytes: -1,
        returnedBytes: entries.length,
        limit: perPage * 5,
        details: { path, ref, pages_fetched: pagesFetched },
      });
    }

    const text = JSON.stringify(
      {
        ref,
        path,
        recursive,
        count: entries.length,
        truncated,
        pages_fetched: pagesFetched,
        entries: entries.map(summarizeEntry),
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizeEntry(e: GitlabTreeEntry) {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    path: e.path,
    mode: e.mode,
  };
}
