import { z } from "zod";
import type {
  GitlabClient,
  UpdateMergeRequestPayload,
} from "../gitlab-client.js";
import { ensureWritesEnabled, projectIdSchema } from "./shared.js";

export const updateMergeRequestInputShape = {
  project_id: projectIdSchema,
  mr_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the MR (the number from the URL like '/-/merge_requests/3137'). NOT the global id.",
    ),
  title: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, {
      message: "title cannot be empty or whitespace-only",
    })
    .optional()
    .describe(
      "New title. Replaces the existing title verbatim. Note: do NOT prepend 'Draft: ' manually — use the `draft` boolean field to toggle draft status.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "New markdown description. Replaces the existing description in full. Pass an empty string to clear.",
    ),
  add_labels: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Labels to ADD. MUTUALLY EXCLUSIVE with `labels`.",
    ),
  remove_labels: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Labels to REMOVE. MUTUALLY EXCLUSIVE with `labels`.",
    ),
  labels: z
    .array(z.string())
    .optional()
    .describe(
      "Replace the MR's labels with this exact list. Pass [] to clear. MUTUALLY EXCLUSIVE with add_labels / remove_labels — passing both is rejected as ambiguous.",
    ),
  assignee_ids: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      "Replace assignees with these user IDs (numeric, NOT usernames). Pass [] or [0] to unassign everyone.",
    ),
  reviewer_ids: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      "Replace requested reviewers with these user IDs. Pass [] or [0] to clear all reviewers. NOT usernames.",
    ),
  milestone_id: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Replace milestone. Pass 0 to unset (GitLab's documented sentinel). Otherwise a positive milestone id.",
    ),
  state_event: z
    .enum(["close", "reopen"])
    .optional()
    .describe(
      "Transition the MR's state. 'close' closes an opened MR; 'reopen' reopens a closed one. Does NOT merge — there is no merge tool here.",
    ),
  draft: z
    .boolean()
    .optional()
    .describe(
      "Toggle the MR's Draft / WIP flag. true = mark as Draft (typically blocks merging in policy); false = clear the Draft flag. Use this rather than editing the title prefix.",
    ),
} as const;

const baseSchema = z.object(updateMergeRequestInputShape);

const refinedSchema = baseSchema.refine(
  (v) =>
    !(
      v.labels !== undefined &&
      (v.add_labels !== undefined || v.remove_labels !== undefined)
    ),
  {
    message:
      "ambiguous label intent: pass either `labels` (full replace) OR `add_labels` / `remove_labels` (incremental), not both",
    path: ["labels"],
  },
);

export type UpdateMergeRequestInput = z.infer<typeof baseSchema>;

export const updateMergeRequestTool = {
  name: "update_merge_request",
  config: {
    title: "Update an existing GitLab merge request",
    description: [
      "WRITES TO GITLAB: updates fields on an existing merge request. Affects everyone with access immediately.",
      "",
      "Use this when the user has explicitly asked to change something on a SPECIFIC MR: rename it, edit its description, change labels, change assignees or reviewers, set/clear a milestone, toggle Draft status, or close/reopen it.",
      "Do NOT use this to merge an MR — there is no merge tool exposed here. Do NOT use it to leave a comment (use comment_on_mr).",
      "",
      "Identify the target with project_id and mr_iid. Every other field is optional — pass only what you want to change.",
      "",
      "LABELS — three modes, mutually exclusive (same rules as update_issue):",
      "  - `labels`: REPLACE the full label set. `[]` clears all labels.",
      "  - `add_labels` / `remove_labels`: INCREMENTAL.",
      "  Passing `labels` together with `add_labels` or `remove_labels` is rejected as ambiguous.",
      "",
      "STATE — `state_event: 'close' | 'reopen'`. Omit to leave unchanged. To MERGE, use the GitLab UI or a separate merge tool (not implemented).",
      "",
      "DRAFT — `draft: true` marks the MR as Draft / WIP; `draft: false` clears the flag. Prefer this over editing the title prefix manually.",
      "",
      "ASSIGNEES & REVIEWERS — pass numeric user IDs, not usernames. `[]` or `[0]` clears that side.",
      "",
      "IDEMPOTENCY: PUT is idempotent for the resulting state, but every call still produces system notes ('changed title from...', 'marked as draft', etc). Repeated identical calls add log noise.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server.",
    ].join("\n"),
    inputSchema: updateMergeRequestInputShape,
  },
} as const;

export function makeUpdateMergeRequestHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (raw: UpdateMergeRequestInput) => {
    ensureWritesEnabled(enableWrites, "update_merge_request");
    const args = refinedSchema.parse(raw);

    const payload: UpdateMergeRequestPayload = {};
    if (args.title !== undefined) payload.title = args.title;
    if (args.description !== undefined) payload.description = args.description;
    if (args.labels !== undefined) payload.labels = args.labels.join(",");
    if (args.add_labels !== undefined)
      payload.add_labels = args.add_labels.join(",");
    if (args.remove_labels !== undefined)
      payload.remove_labels = args.remove_labels.join(",");
    if (args.assignee_ids !== undefined)
      payload.assignee_ids = args.assignee_ids;
    if (args.reviewer_ids !== undefined)
      payload.reviewer_ids = args.reviewer_ids;
    if (args.milestone_id !== undefined)
      payload.milestone_id = args.milestone_id;
    if (args.state_event !== undefined) payload.state_event = args.state_event;
    if (args.draft !== undefined) payload.draft = args.draft;

    const mr = await client.updateMergeRequest(
      args.project_id,
      args.mr_iid,
      payload,
    );
    const text = JSON.stringify({ ok: true, merge_request: mr }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}
