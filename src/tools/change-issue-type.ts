import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import {
  ensureWritesEnabled,
  projectIdSchema,
  resolveProjectPath,
} from "./shared.js";

export const changeIssueTypeInputShape = {
  project_id: projectIdSchema,
  issue_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Project-local iid of the issue/task to convert (the number shown in the issue URL and UI, e.g. the 12 in #12). NOT the global id.",
    ),
  new_type: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, {
      message: "new_type cannot be empty or whitespace-only",
    })
    .describe(
      "Target work item type NAME, e.g. 'Issue', 'Task', 'Incident', 'Epic', 'Test Case'. Matched case-insensitively against the types this GitLab instance actually offers (underscores/hyphens tolerated, so 'test_case' works). An unknown name fails with the list of available types.",
    ),
} as const;

const inputSchema = z.object(changeIssueTypeInputShape);
export type ChangeIssueTypeInput = z.infer<typeof inputSchema>;

export const changeIssueTypeTool = {
  name: "change_issue_type",
  config: {
    title: "Change the type of a GitLab issue/task",
    description: [
      "WRITES TO GITLAB: converts a work item to a different TYPE — e.g. Issue → Task, Issue → Incident, Task → Issue, Issue → Epic. Uses the work-items GraphQL API (workItemConvert) under the hood.",
      "",
      "Use this when the user says things like: 'convert this issue to a task', 'this should be an incident', 'change #12 to an epic', 'turn this task back into an issue', 'reclassify this ticket as a test case'.",
      "",
      "Do NOT use this to set a parent/child relationship (use set_issue_parent), and do NOT use it for labels, state, or assignees (use update_issue). A label named 'incident' is not the same as the Incident type.",
      "",
      "The ticket keeps its iid, title, comments, and compatible fields. GitLab may DROP data tied to the old type during conversion (e.g. incident-specific fields when leaving Incident) — warn the user if they are converting away from a type with special fields. Which conversions are allowed depends on the instance tier and version (Epic in particular may be rejected on some instances); a disallowed conversion comes back as the verbatim GitLab rejection — surface it rather than retrying.",
      "",
      "If the ticket already has the requested type, the call fails with a clear 'already of type' message instead of hitting GitLab — treat that as 'nothing to do', not a real error.",
      "",
      "Returns the converted item (iid, title, new type, web_url) plus previous_type.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server.",
    ].join("\n"),
    inputSchema: changeIssueTypeInputShape,
  },
} as const;

export function makeChangeIssueTypeHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (args: ChangeIssueTypeInput) => {
    ensureWritesEnabled(enableWrites, "change_issue_type");
    const projectPath = await resolveProjectPath(client, args.project_id);
    const result = await client.changeWorkItemType(
      projectPath,
      args.issue_iid,
      args.new_type,
    );
    const text = JSON.stringify(
      { ok: true, previous_type: result.previous_type, item: result.item },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}
