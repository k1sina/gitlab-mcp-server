import { z } from "zod";
import type { GitlabClient, UpdateIssuePayload } from "../gitlab-client.js";
import { ensureWritesEnabled, projectIdSchema } from "./shared.js";

export const updateIssueInputShape = {
  project_id: projectIdSchema,
  issue_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the issue (the number from the URL like '/-/issues/355'). NOT the global id.",
    ),
  title: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, {
      message: "title cannot be empty or whitespace-only",
    })
    .optional()
    .describe("New title. Replaces the existing title verbatim."),
  description: z
    .string()
    .optional()
    .describe(
      "New markdown description. Replaces the existing description in full — there is no append/prepend mode. Pass an empty string to clear.",
    ),
  add_labels: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Labels to ADD to the issue's existing label set. Combine with remove_labels for granular changes. MUTUALLY EXCLUSIVE with `labels` (use one or the other).",
    ),
  remove_labels: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Labels to REMOVE from the issue's existing label set. MUTUALLY EXCLUSIVE with `labels`.",
    ),
  labels: z
    .array(z.string())
    .optional()
    .describe(
      "Replace the issue's labels with this exact list. Pass [] to clear all labels. MUTUALLY EXCLUSIVE with add_labels / remove_labels — passing both is rejected as ambiguous.",
    ),
  assignee_ids: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      "Replace assignees with these user IDs. NOT usernames. Pass [] to unassign everyone. Pass [0] (a single zero) — GitLab's documented sentinel — to also unassign.",
    ),
  milestone_id: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Replace milestone. Pass 0 to unset the milestone (GitLab's documented sentinel). Otherwise a positive milestone id.",
    ),
  state_event: z
    .enum(["close", "reopen"])
    .optional()
    .describe(
      "Transition the issue's state. 'close' closes an opened issue; 'reopen' reopens a closed one. Omit to leave state unchanged.",
    ),
} as const;

const baseSchema = z.object(updateIssueInputShape);

// Mutually-exclusive labels-vs-add/remove rule. Enforced inside the handler
// (the MCP SDK builds JSON Schema from the raw shape and won't carry refine()
// constraints, so we re-parse here to surface a clear ZodError on conflict).
const refinedSchema = baseSchema.refine(
  (v) => !(v.labels !== undefined && (v.add_labels !== undefined || v.remove_labels !== undefined)),
  {
    message:
      "ambiguous label intent: pass either `labels` (full replace) OR `add_labels` / `remove_labels` (incremental), not both",
    path: ["labels"],
  },
);

export type UpdateIssueInput = z.infer<typeof baseSchema>;

export const updateIssueTool = {
  name: "update_issue",
  config: {
    title: "Update an existing GitLab issue",
    description: [
      "WRITES TO GITLAB: updates fields on an existing issue. Affects everyone with access to the issue immediately.",
      "",
      "Use this when the user has explicitly asked to change something on a SPECIFIC issue: rename it, edit its description, add or remove labels, change assignees, set/clear a milestone, or close/reopen it.",
      "",
      "Identify the target with project_id (numeric preferred or 'group/repo' path) and issue_iid (the per-project number). Every other field is optional — pass only what you want to change.",
      "",
      "LABELS — three modes, mutually exclusive:",
      "  - `labels`: REPLACE the full label set with this list. `[]` clears all labels.",
      "  - `add_labels` / `remove_labels`: INCREMENTAL — adds/removes from the current set without touching others.",
      "  Passing `labels` together with `add_labels` or `remove_labels` is rejected as ambiguous.",
      "",
      "STATE — `state_event: 'close'` closes an open issue; `'reopen'` reopens a closed one. Omit to leave unchanged.",
      "",
      "ASSIGNEES — pass numeric user ids, not usernames. Per GitLab convention, `assignee_ids: [0]` or `[]` unassigns everyone.",
      "",
      "IDEMPOTENCY: PUT is idempotent for the resulting state, but every call still produces system notes in the issue timeline (e.g. 'changed title from X to Y'). Repeated identical calls add log noise even though the visible state stops changing.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server.",
    ].join("\n"),
    inputSchema: updateIssueInputShape,
  },
} as const;

export function makeUpdateIssueHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (raw: UpdateIssueInput) => {
    ensureWritesEnabled(enableWrites, "update_issue");
    const args = refinedSchema.parse(raw);

    const payload: UpdateIssuePayload = {};
    if (args.title !== undefined) payload.title = args.title;
    if (args.description !== undefined) payload.description = args.description;
    if (args.labels !== undefined) payload.labels = args.labels.join(",");
    if (args.add_labels !== undefined)
      payload.add_labels = args.add_labels.join(",");
    if (args.remove_labels !== undefined)
      payload.remove_labels = args.remove_labels.join(",");
    if (args.assignee_ids !== undefined)
      payload.assignee_ids = args.assignee_ids;
    if (args.milestone_id !== undefined)
      payload.milestone_id = args.milestone_id;
    if (args.state_event !== undefined) payload.state_event = args.state_event;

    const issue = await client.updateIssue(
      args.project_id,
      args.issue_iid,
      payload,
    );
    const text = JSON.stringify({ ok: true, issue }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}
