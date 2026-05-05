import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import { parseDuration } from "../duration.js";
import { projectIdSchema, targetTypeSchema } from "./shared.js";

export const logTimeInputShape = {
  target_type: targetTypeSchema,
  project_id: projectIdSchema,
  iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the issue or MR (the number from the URL like '/-/issues/355' or '/-/merge_requests/3137'). Match the target_type.",
    ),
  duration: z
    .string()
    .min(1)
    .describe(
      "How much time to log, GitLab-style: '1h30m', '2h', '45m', '1w 2d 4h', etc. Units: w=week (5d), d=day (8h), h=hour, m=minute, s=second. Must be positive — use delete_time to subtract.",
    ),
  summary: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Optional one-line description of what the time was spent on. Shown in GitLab's time-tracking UI next to the entry.",
    ),
  date_time: z
    .string()
    .optional()
    .describe(
      "Optional. When the work actually occurred — accepts 'YYYY-MM-DD' for backdating or a full ISO 8601 timestamp. Defaults to now if omitted.",
    ),
} as const;

const inputSchema = z.object(logTimeInputShape);
export type LogTimeInput = z.infer<typeof inputSchema>;

export const logTimeTool = {
  name: "log_time",
  config: {
    title: "Log time spent on a GitLab issue or MR",
    description: [
      "Append a time-spent entry to a GitLab issue or merge request. WRITES to GitLab — modifies the cumulative time_spent counter and creates a system note visible in the discussion timeline.",
      "",
      "Use this when the user says: 'log 30m on issue 355', 'I spent 2 hours on MR 3137 yesterday', 'add 1h to support 354 with summary investigating screenreader bug'.",
      "Do NOT use this to subtract time (use delete_time) or to look up current totals (use get_time).",
      "",
      "Identify the target with target_type ('issue' | 'merge_request'), project_id (numeric preferred), and iid.",
      "",
      "Duration is GitLab format: combine units w/d/h/m/s. Examples: '30m', '1h30m', '2h', '1w 2d'. Units mean: w=5 working days, d=8 hours, h=hour, m=minute, s=second.",
      "Optional `summary` shows up in the time-tracking UI. Optional `date_time` ('YYYY-MM-DD' or full ISO) backdates the entry.",
      "",
      "Returns the updated time_stats so the caller sees the new total in one round trip.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server. If writes are off, this tool returns a clear error explaining how to enable.",
    ].join("\n"),
    inputSchema: logTimeInputShape,
  },
} as const;

export function makeLogTimeHandler(client: GitlabClient, enableWrites: boolean) {
  return async (args: LogTimeInput) => {
    if (!enableWrites) {
      throw new Error(
        "Writes are disabled. Set GITLAB_ENABLE_WRITES=true on the MCP server to allow log_time / delete_time.",
      );
    }
    const seconds = parseDuration(args.duration);
    if (seconds <= 0) {
      throw new Error(
        `log_time requires a positive duration; got ${JSON.stringify(args.duration)}. Use delete_time to subtract.`,
      );
    }
    const stats = await client.addSpentTime(
      args.target_type,
      args.project_id,
      args.iid,
      args.duration,
      {
        ...(args.summary !== undefined ? { summary: args.summary } : {}),
        ...(args.date_time !== undefined ? { dateTime: args.date_time } : {}),
      },
    );
    const text = JSON.stringify(
      {
        ok: true,
        action: "logged",
        target_type: args.target_type,
        project_id: args.project_id,
        iid: args.iid,
        duration_logged: args.duration,
        time_stats: stats,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}
