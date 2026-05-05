import { z } from "zod";
import type { GitlabBlobMatch, GitlabClient } from "../gitlab-client.js";
import { projectIdSchema } from "./shared.js";

export const searchCodeInputShape = {
  query: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, {
      message: "query cannot be empty or whitespace-only",
    })
    .describe(
      "Substring to search for in indexed blob content. CASE-INSENSITIVE. SUBSTRING-ONLY — no regex, no glob, no fuzzy matching. Quote whole phrases verbatim. Use the shortest distinctive substring of the symbol/string you're after.",
    ),
  project_id: projectIdSchema
    .optional()
    .describe(
      "Optional. If set, scopes the search to one project (uses /projects/:id/search). If omitted, searches across every project the authenticated user can access (uses /search).",
    ),
  ref: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Branch/tag/SHA to search at. Only meaningful with project_id. When omitted, GitLab searches at the project's default branch. Ignored for global search.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Max matches to return (1-100, default 30). Forwarded as per_page to GitLab.",
    ),
} as const;

const inputSchema = z.object(searchCodeInputShape);
export type SearchCodeInput = z.infer<typeof inputSchema>;

export const searchCodeTool = {
  name: "search_code",
  config: {
    title: "Search file contents on GitLab (substring, case-insensitive)",
    description: [
      "Search across indexed file contents in a single project or globally. READ-ONLY.",
      "",
      "Use this when the user asks 'where is X used', 'find all calls to Y', 'which file defines Z'. Pass project_id to scope to one project; omit it for an instance-wide search.",
      "Do NOT use this to find PROJECTS by name — that's search_projects. Do NOT use this to list files when you already know the directory — that's list_repository_tree.",
      "",
      "MATCHING SEMANTICS — read carefully and adjust your query accordingly:",
      "  - SUBSTRING ONLY. No regex. No glob patterns. No fuzzy matching. The query is matched as a literal substring against indexed file content.",
      "  - Case-insensitive.",
      "  - On self-hosted GitLab, GLOBAL blob search requires Elasticsearch indexing on the instance. Without it, global search returns an empty list or an error. Project-scoped search (with project_id set) works against the project's git index without Elasticsearch.",
      "  - Indexing lag exists — recently-pushed code may not appear immediately.",
      "",
      "Tips: prefer the shortest distinctive substring of the symbol you're after (e.g. 'parseTimeNote' rather than the full call). To find an exact phrase, just pass it verbatim — quotes are not interpreted as anything special.",
      "",
      "Returns: { scope ('project'|'global'), count, matches: [{ project_id, path, ref, startline, data }] }. `data` is GitLab's snippet (typically ~3 lines of context around the hit). `startline` is the 1-based line number of the FIRST line of `data` in the file.",
    ].join("\n"),
    inputSchema: searchCodeInputShape,
  },
} as const;

export function makeSearchCodeHandler(client: GitlabClient) {
  return async (args: SearchCodeInput) => {
    const limit = args.limit ?? 30;
    const matches: GitlabBlobMatch[] =
      args.project_id !== undefined
        ? await client.searchProjectBlobs(args.project_id, args.query, {
            ...(args.ref !== undefined ? { ref: args.ref } : {}),
            perPage: limit,
          })
        : await client.searchGlobalBlobs(args.query, limit);

    const summary = matches.map(summarizeMatch);
    const text = JSON.stringify(
      {
        scope: args.project_id !== undefined ? "project" : "global",
        query: args.query,
        count: summary.length,
        matches: summary,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizeMatch(m: GitlabBlobMatch) {
  return {
    project_id: m.project_id,
    path: m.path,
    ref: m.ref,
    startline: m.startline,
    data: m.data,
  };
}
