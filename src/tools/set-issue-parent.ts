import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import {
  ensureWritesEnabled,
  projectIdSchema,
  resolveProjectPath,
} from "./shared.js";

export const setIssueParentInputShape = {
  project_id: projectIdSchema.describe(
    "Project of the CHILD issue/task. Either the numeric project ID (e.g. 236) or the full path (e.g. 'jakota/support').",
  ),
  issue_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Project-local iid of the CHILD issue/task (the number shown in the issue URL and UI, e.g. the 12 in #12). NOT the global id.",
    ),
  parent_issue_iid: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Project-local iid of the PARENT work item. Required unless remove_parent is true.",
    ),
  parent_project_id: projectIdSchema.optional().describe(
    "Project of the PARENT, if it lives in a different project than the child. Omit when parent and child are in the same project (the common case).",
  ),
  remove_parent: z
    .boolean()
    .optional()
    .describe(
      "Set true to DETACH the issue from its current parent instead of setting one. Mutually exclusive with parent_issue_iid.",
    ),
} as const;

const inputSchema = z.object(setIssueParentInputShape);
export type SetIssueParentInput = z.infer<typeof inputSchema>;

export const setIssueParentTool = {
  name: "set_issue_parent",
  config: {
    title: "Set or remove the parent of a GitLab issue/task",
    description: [
      "WRITES TO GITLAB: sets (or removes) the PARENT of an issue or task, creating a parent/child relationship — what the GitLab UI shows as 'Child items'. Uses the work-items GraphQL API under the hood.",
      "",
      "Use this when the user says things like: 'make #12 a child of #5', 'set the parent of this ticket', 'add this as a subtask of that issue', 'move this task under issue X', or 'detach/remove this issue from its parent'.",
      "",
      "Do NOT use this for 'relates to' / 'blocks' relationships (GitLab linked issues — a different feature this server does not expose). Do NOT use it to set a milestone or labels — use update_issue for those.",
      "",
      "GitLab enforces which types may nest (e.g. Task under Issue, Issue under Epic; exact rules depend on instance tier and version). If a combination is not allowed, GitLab rejects the call and the rejection message is returned verbatim — surface it to the user rather than retrying.",
      "",
      "Identify both tickets by project + iid. parent_project_id defaults to project_id (same-project parent). Setting a parent REPLACES any existing parent; pass remove_parent: true (and no parent_issue_iid) to detach instead.",
      "",
      "Returns the child and its new parent (iid, title, work-item type, web_url); parent is null after a removal. It does NOT return the parent's other children — use get_issue on the parent for context.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server.",
    ].join("\n"),
    inputSchema: setIssueParentInputShape,
  },
} as const;

export function makeSetIssueParentHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (args: SetIssueParentInput) => {
    ensureWritesEnabled(enableWrites, "set_issue_parent");

    const removing = args.remove_parent === true;
    if (removing && args.parent_issue_iid !== undefined) {
      throw new Error(
        "Pass either parent_issue_iid (to set a parent) or remove_parent: true (to detach) — not both.",
      );
    }
    if (!removing && args.parent_issue_iid === undefined) {
      throw new Error(
        "parent_issue_iid is required (or pass remove_parent: true to detach the current parent).",
      );
    }

    // GraphQL addresses projects by full path, so numeric ids take one REST
    // lookup first.
    const childPath = await resolveProjectPath(client, args.project_id);
    const parent = removing
      ? null
      : {
          projectPath:
            args.parent_project_id !== undefined
              ? await resolveProjectPath(client, args.parent_project_id)
              : childPath,
          iid: args.parent_issue_iid!,
        };

    const result = await client.setWorkItemParent(
      childPath,
      args.issue_iid,
      parent,
    );
    const text = JSON.stringify({ ok: true, ...result }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}
