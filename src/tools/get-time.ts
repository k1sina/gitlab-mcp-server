import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import { formatDuration } from "../duration.js";
import { projectIdSchema, targetTypeSchema } from "./shared.js";

export const getTimeInputShape = {
  target_type: targetTypeSchema,
  project_id: projectIdSchema,
  iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the issue or MR. Must match the target_type.",
    ),
} as const;

const inputSchema = z.object(getTimeInputShape);
export type GetTimeInput = z.infer<typeof inputSchema>;

export const getTimeTool = {
  name: "get_time",
  config: {
    title: "Get current time-tracking stats for an issue or MR",
    description: [
      "Read the current time-tracking totals for a single GitLab issue or merge request: estimated time and total time spent (cumulative across everyone who has logged).",
      "",
      "Use this when the user asks: 'how much time is on issue 355', 'what's the estimate vs spent on MR 3137', 'is this ticket over budget'.",
      "Do NOT use this to log new time (log_time), correct mistakes (delete_time), or build a per-day report (report_time).",
      "",
      "READ-ONLY — does not modify GitLab state. Returns: { time_estimate (seconds), total_time_spent (seconds), human_time_estimate, human_total_time_spent, over_estimate (bool|null) }.",
      "",
      "Note: this returns the total across ALL users — not just the current user. For a per-user/per-day breakdown use report_time.",
    ].join("\n"),
    inputSchema: getTimeInputShape,
  },
} as const;

export function makeGetTimeHandler(client: GitlabClient) {
  return async (args: GetTimeInput) => {
    const stats = await client.getTimeStats(
      args.target_type,
      args.project_id,
      args.iid,
    );
    const overEstimate =
      stats.time_estimate > 0
        ? stats.total_time_spent > stats.time_estimate
        : null;
    const text = JSON.stringify(
      {
        target_type: args.target_type,
        project_id: args.project_id,
        iid: args.iid,
        time_estimate_seconds: stats.time_estimate,
        total_time_spent_seconds: stats.total_time_spent,
        human_time_estimate:
          stats.human_time_estimate ?? formatDuration(stats.time_estimate),
        human_total_time_spent:
          stats.human_total_time_spent ?? formatDuration(stats.total_time_spent),
        over_estimate: overEstimate,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}
