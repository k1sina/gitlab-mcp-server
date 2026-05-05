import { z } from "zod";
import type { GitlabClient, GitlabProjectRef } from "../gitlab-client.js";

export const searchProjectsInputShape = {
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Free-text search applied to project name and path. GitLab matches case-insensitively against the project's name, path, and namespace. Use the shortest distinctive substring (e.g. 'rostock' rather than the full path).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Max number of projects to return (1-100). Defaults to 20. Results are ordered by last_activity_at descending — most-active projects first.",
    ),
} as const;

const inputSchema = z.object(searchProjectsInputShape);
export type SearchProjectsInput = z.infer<typeof inputSchema>;

export const searchProjectsTool = {
  name: "search_projects",
  config: {
    title: "Search GitLab projects by name or path",
    description: [
      "Search the configured GitLab instance for projects whose name, path, or namespace match a query string. Used to discover the numeric project_id you need before calling project-scoped tools (list_project_pipelines, get_issue, get_merge_request).",
      "",
      "Use this when the user mentions a project by name and you don't already know the id: 'do we have a project for rostock-port', 'find the typo3 base repo', 'what's the project_id for support'.",
      "Do NOT use this to list issues or MRs — that's list_my_issues / list_my_merge_requests. Do NOT call this every time a project_id is needed if it's already known from a previous response.",
      "",
      "Results are ordered by last_activity_at desc, so the most actively-developed match comes first — usually what the user wants.",
      "",
      "Returns: { count, projects: [...] }. Each project has: id (the numeric project_id you'll pass to other tools), path_with_namespace (e.g. 'jakota/rostock-port/website'), default_branch, web_url, description, visibility, archived, last_activity_at, star/fork counts.",
    ].join("\n"),
    inputSchema: searchProjectsInputShape,
  },
} as const;

export function makeSearchProjectsHandler(client: GitlabClient) {
  return async (args: SearchProjectsInput) => {
    const projects = await client.searchProjects(args.query, args.limit ?? 20);
    const summary = projects.map(summarizeProject);
    const text =
      summary.length === 0
        ? `No projects matched query: ${JSON.stringify(args.query)}.`
        : JSON.stringify({ count: summary.length, projects: summary }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizeProject(p: GitlabProjectRef) {
  return {
    id: p.id,
    path_with_namespace: p.path_with_namespace,
    name: p.name,
    description: p.description,
    default_branch: p.default_branch,
    visibility: p.visibility,
    archived: p.archived,
    web_url: p.web_url,
    last_activity_at: p.last_activity_at,
    star_count: p.star_count,
    forks_count: p.forks_count,
  };
}
