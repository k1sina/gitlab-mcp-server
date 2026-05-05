import { z } from "zod";
import type { CreateIssuePayload, GitlabClient } from "../gitlab-client.js";
import { ensureWritesEnabled, projectIdSchema } from "./shared.js";

export const createIssueInputShape = {
  project_id: projectIdSchema,
  title: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, {
      message: "title cannot be empty or whitespace-only",
    })
    .describe(
      "Issue title (required). Shown verbatim — GitLab does not modify it. Keep it short; put detail in the description.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Markdown body of the issue. Optional but strongly recommended for anything beyond a one-line task.",
    ),
  labels: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Labels to apply at creation time. Each must already exist in the project — GitLab silently drops unknown labels (and may reject the request entirely on stricter instances). Pass an empty array or omit to skip.",
    ),
  assignee_ids: z
    .array(z.number().int().positive())
    .optional()
    .describe(
      "Numeric user ids to assign. NOT usernames. Pass an empty array or omit to skip.",
    ),
  milestone_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Numeric milestone id (project- or group-scoped). Omit to leave milestone unset.",
    ),
  confidential: z
    .boolean()
    .optional()
    .describe(
      "If true, the issue is created as confidential (visible only to project members with reporter+ access).",
    ),
} as const;

const inputSchema = z.object(createIssueInputShape);
export type CreateIssueInput = z.infer<typeof inputSchema>;

export const createIssueTool = {
  name: "create_issue",
  config: {
    title: "Create a new GitLab issue",
    description: [
      "WRITES TO GITLAB: creates a new issue in a project. The new issue is immediately visible to anyone with access to the project.",
      "",
      "Use this only when the user has explicitly asked to file, open, or create a NEW issue. Do NOT use this to update an existing issue (use update_issue), and do NOT speculatively create issues to track conversation context.",
      "",
      "Required: project_id (numeric preferred or 'group/repo' path) and title. Everything else is optional.",
      "",
      "Labels: pass an array of label names. Each label must already exist on the project; GitLab will reject or drop unknown labels depending on instance config. Use search_projects + the project's label list to verify before calling if uncertain.",
      "",
      "Assignees: pass an array of NUMERIC user ids (not usernames). Look these up first if the user gives you a name.",
      "",
      "IDEMPOTENCY: GitLab does NOT deduplicate issues — calling this twice with the same title produces two issues. If the call returns an error, do not blindly retry; check the project's issue list first to confirm whether the previous attempt succeeded.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server.",
    ].join("\n"),
    inputSchema: createIssueInputShape,
  },
} as const;

export function makeCreateIssueHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (args: CreateIssueInput) => {
    ensureWritesEnabled(enableWrites, "create_issue");
    const payload: CreateIssuePayload = { title: args.title };
    if (args.description !== undefined) payload.description = args.description;
    if (args.labels !== undefined) payload.labels = args.labels.join(",");
    if (args.assignee_ids !== undefined)
      payload.assignee_ids = args.assignee_ids;
    if (args.milestone_id !== undefined)
      payload.milestone_id = args.milestone_id;
    if (args.confidential !== undefined)
      payload.confidential = args.confidential;

    const issue = await client.createIssue(args.project_id, payload);
    const text = JSON.stringify({ ok: true, issue }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}
