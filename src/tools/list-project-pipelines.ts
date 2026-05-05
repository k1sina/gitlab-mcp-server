import { z } from "zod";
import type { GitlabClient, GitlabPipelineRef } from "../gitlab-client.js";
import { projectIdSchema } from "./shared.js";

export const listProjectPipelinesInputShape = {
  project_id: projectIdSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Number of most recent pipelines to return (1-100). Defaults to 20. Pipelines are returned newest-first by id.",
    ),
} as const;

const inputSchema = z.object(listProjectPipelinesInputShape);
export type ListProjectPipelinesInput = z.infer<typeof inputSchema>;

export const listProjectPipelinesTool = {
  name: "list_project_pipelines",
  config: {
    title: "List recent CI pipelines for a project",
    description: [
      "List the most recent CI/CD pipelines for a single GitLab project, newest first.",
      "",
      "Use this when the user asks about CI status: 'is the build green', 'did the last deploy pass', 'what's failing on develop', 'show me recent pipelines for X', 'why is master red'.",
      "Do NOT use this to find which projects exist (use search_projects), and do NOT use it for issue or MR status — pipelines describe CI runs, not work items.",
      "",
      "Identifying a project requires project_id (numeric is preferred; 'group/repo' path also works).",
      "",
      "Returns: { count, pipelines: [...] }. Each pipeline has: id, status (success/failed/running/canceled/skipped/pending/manual/...), source (push/schedule/web/merge_request_event/...), ref (the branch or tag), sha (full git commit), web_url, and timestamps. Job-level details, logs, and durations are NOT included — fetch the pipeline detail endpoint separately if needed (not yet a tool).",
      "",
      "To answer 'is X branch green?' filter the returned list to entries where ref===X and status==='success' or 'failed'. Pipelines with status 'manual', 'skipped', 'created', 'waiting_for_resource' have not actually run a result.",
    ].join("\n"),
    inputSchema: listProjectPipelinesInputShape,
  },
} as const;

export function makeListProjectPipelinesHandler(client: GitlabClient) {
  return async (args: ListProjectPipelinesInput) => {
    const pipelines = await client.listProjectPipelines(
      args.project_id,
      args.limit ?? 20,
    );
    const summary = pipelines.map(summarizePipeline);
    const text =
      summary.length === 0
        ? `No pipelines found for project ${args.project_id}.`
        : JSON.stringify({ count: summary.length, pipelines: summary }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizePipeline(p: GitlabPipelineRef) {
  return {
    id: p.id,
    status: p.status,
    source: p.source,
    ref: p.ref,
    sha: p.sha,
    sha_short: p.sha.slice(0, 8),
    name: p.name ?? null,
    web_url: p.web_url,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
