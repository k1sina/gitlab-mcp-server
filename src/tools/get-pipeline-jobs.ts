import { z } from "zod";
import type { GitlabClient, GitlabPipelineJob } from "../gitlab-client.js";
import { projectIdSchema } from "./shared.js";

export const getPipelineJobsInputShape = {
  project_id: projectIdSchema,
  pipeline_id: z
    .number()
    .int()
    .positive()
    .describe(
      "Numeric pipeline id (NOT iid). Pipelines have a single global id in GitLab; list_project_pipelines returns it as `id`.",
    ),
  scope: z
    .enum([
      "created",
      "pending",
      "running",
      "failed",
      "success",
      "canceled",
      "skipped",
      "manual",
    ])
    .optional()
    .describe(
      "Filter to jobs in one state. Common: 'failed' for triage. Omit to return jobs in every state.",
    ),
} as const;

const inputSchema = z.object(getPipelineJobsInputShape);
export type GetPipelineJobsInput = z.infer<typeof inputSchema>;

export const getPipelineJobsTool = {
  name: "get_pipeline_jobs",
  config: {
    title: "List the jobs inside a single GitLab pipeline",
    description: [
      "List the jobs of one pipeline — used to drill INTO a pipeline once you know it failed and want to know which jobs failed. READ-ONLY.",
      "",
      "Use this when the user asks 'why did pipeline 12345 fail', 'which jobs are running', 'show me the failed jobs in this build'. Pair with get_job_log to read the actual log of a specific job.",
      "Do NOT use this to list pipelines (that's list_project_pipelines — newest pipelines for a project). Do NOT use this to read job logs (that's get_job_log).",
      "",
      "Identify with project_id and pipeline_id. Optional `scope` narrows to a single state — 'failed' is the most common for triage.",
      "",
      "Returns: { count, jobs: [{ id, name, stage, status, ref, created_at, started_at, finished_at, duration, web_url, failure_reason }] }. Sorted alphabetically by stage then by name for stable output.",
    ].join("\n"),
    inputSchema: getPipelineJobsInputShape,
  },
} as const;

export function makeGetPipelineJobsHandler(client: GitlabClient) {
  return async (args: GetPipelineJobsInput) => {
    const jobs = await client.getPipelineJobs(
      args.project_id,
      args.pipeline_id,
      args.scope,
    );
    const sorted = [...jobs].sort((a, b) => {
      const s = a.stage.localeCompare(b.stage);
      return s !== 0 ? s : a.name.localeCompare(b.name);
    });
    const summary = sorted.map(summarizeJob);
    const text = JSON.stringify(
      { count: summary.length, jobs: summary },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizeJob(j: GitlabPipelineJob) {
  return {
    id: j.id,
    name: j.name,
    stage: j.stage,
    status: j.status,
    ref: j.ref,
    created_at: j.created_at,
    started_at: j.started_at,
    finished_at: j.finished_at,
    duration: j.duration,
    web_url: j.web_url,
    failure_reason: j.failure_reason ?? null,
  };
}
