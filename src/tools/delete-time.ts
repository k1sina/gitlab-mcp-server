import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import { parseDuration } from "../duration.js";
import { projectIdSchema, targetTypeSchema } from "./shared.js";

export const deleteTimeInputShape = {
  target_type: targetTypeSchema,
  project_id: projectIdSchema,
  iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the issue or MR. Must match the target_type.",
    ),
  duration: z
    .string()
    .min(1)
    .describe(
      "How much time to subtract from the cumulative spent time. Same GitLab format as log_time ('30m', '1h', '2h30m'). Provide a POSITIVE value — the tool prepends the minus sign internally.",
    ),
  summary: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Optional one-line description shown next to the correction in GitLab's UI (e.g. 'logged twice by mistake').",
    ),
} as const;

const inputSchema = z.object(deleteTimeInputShape);
export type DeleteTimeInput = z.infer<typeof inputSchema>;

export const deleteTimeTool = {
  name: "delete_time",
  config: {
    title: "Subtract a duration from a GitLab issue/MR's spent time",
    description: [
      "Subtract a duration from the cumulative time_spent counter on an issue or MR — used to correct an over-logged amount. WRITES to GitLab.",
      "",
      "Use this when the user says: 'I logged 1h too much on issue 355', 'remove 30m from MR 3137', 'I logged the wrong duration, subtract 2h'.",
      "Do NOT use this to wipe ALL time on the target (GitLab's reset_spent_time, which this tool deliberately does NOT expose).",
      "Do NOT use this to remove a specific past entry — GitLab's API has no concept of per-entry delete; this just adjusts the running total.",
      "",
      "Identify the target with target_type, project_id, iid. Duration is a POSITIVE value in GitLab format ('30m', '1h', '2h15m'); the tool flips the sign internally before calling add_spent_time.",
      "",
      "Returns the updated time_stats so the caller sees the new total. Note: GitLab allows the cumulative total to go negative if you subtract more than was logged — the tool does not prevent that.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true. If writes are off, returns a clear error.",
    ].join("\n"),
    inputSchema: deleteTimeInputShape,
  },
} as const;

export function makeDeleteTimeHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (args: DeleteTimeInput) => {
    if (!enableWrites) {
      throw new Error(
        "Writes are disabled. Set GITLAB_ENABLE_WRITES=true on the MCP server to allow log_time / delete_time.",
      );
    }
    const seconds = parseDuration(args.duration);
    if (seconds <= 0) {
      throw new Error(
        `delete_time requires a positive duration to subtract; got ${JSON.stringify(args.duration)}.`,
      );
    }
    const stats = await client.addSpentTime(
      args.target_type,
      args.project_id,
      args.iid,
      `-${args.duration.trim().replace(/^[-+]/, "")}`,
      args.summary !== undefined ? { summary: args.summary } : {},
    );
    const text = JSON.stringify(
      {
        ok: true,
        action: "subtracted",
        target_type: args.target_type,
        project_id: args.project_id,
        iid: args.iid,
        duration_subtracted: args.duration,
        time_stats: stats,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}
