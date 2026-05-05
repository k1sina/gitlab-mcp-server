import { z } from "zod";
import type {
  GitlabClient,
  GitlabMergeRequestChange,
  GitlabMergeRequestChanges,
  GitlabMergeRequestDetail,
} from "../gitlab-client.js";
import { filterNotes, projectIdSchema, summarizeNote } from "./shared.js";

export const getMergeRequestInputShape = {
  project_id: projectIdSchema,
  mr_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "The MR's per-project iid — the number you see in URLs like /-/merge_requests/17 (NOT the global `id`). list_my_merge_requests returns this as `mr_iid`.",
    ),
  include_diffs: z
    .boolean()
    .optional()
    .describe(
      "Whether to fetch the file changes (diffs). Default false — diffs can be very large and burn context. Turn on only when the user explicitly wants to read or review the actual code change.",
    ),
  include_notes: z
    .boolean()
    .optional()
    .describe(
      "Whether to fetch comments (notes). Default true. Set to false for a faster call when you only need the MR description and metadata.",
    ),
  include_system_notes: z
    .boolean()
    .optional()
    .describe(
      "Whether to include GitLab system-generated notes (approval changes, branch updates, label changes, etc). Default false. Turn on only when reconstructing a timeline.",
    ),
} as const;

const inputSchema = z.object(getMergeRequestInputShape);
export type GetMergeRequestInput = z.infer<typeof inputSchema>;

export const getMergeRequestTool = {
  name: "get_merge_request",
  config: {
    title: "Get GitLab merge request with description, diffs, and comments",
    description: [
      "Fetch the full detail of a single GitLab merge request — description, branches, merge status, assignees, reviewers, labels, milestone, and (optionally) the file diffs and comment thread.",
      "",
      "Use this when the user has identified a specific MR (by URL, iid, or name from list_my_merge_requests) and wants details: 'what does MR 17 do', 'show me the description', 'review the diff', 'what's the discussion on...', 'why is this blocked'.",
      "Do NOT use this to discover which MRs exist — use list_my_merge_requests. Do NOT use it for issues — use get_issue.",
      "",
      "Identifying an MR requires BOTH project_id AND mr_iid:",
      "- project_id: numeric project id (preferred) or 'group/repo' path",
      "- mr_iid: the per-project number from the URL like '/-/merge_requests/17'",
      "",
      "DIFFS ARE OFF BY DEFAULT — they can be huge and consume model context fast. Pass include_diffs=true only when the user explicitly asks to see the code change.",
      "By default system notes are filtered out (approval/branch/label bookkeeping); pass include_system_notes=true for a full audit timeline.",
      "",
      "Returns: { merge_request: {...}, changes: [...] | null, notes: [...] | null }. `changes` is null unless include_diffs=true; `notes` is null unless include_notes=true.",
    ].join("\n"),
    inputSchema: getMergeRequestInputShape,
  },
} as const;

export function makeGetMergeRequestHandler(client: GitlabClient) {
  return async (args: GetMergeRequestInput) => {
    const includeDiffs = args.include_diffs ?? false;
    const includeNotes = args.include_notes ?? true;
    const includeSystem = args.include_system_notes ?? false;

    const [mr, changes, rawNotes] = await Promise.all([
      client.getMergeRequest(args.project_id, args.mr_iid),
      includeDiffs
        ? client.getMergeRequestChanges(args.project_id, args.mr_iid)
        : Promise.resolve(null),
      includeNotes
        ? client.listMergeRequestNotes(args.project_id, args.mr_iid)
        : Promise.resolve([]),
    ]);

    const notes = includeNotes
      ? filterNotes(rawNotes, includeSystem).map(summarizeNote)
      : null;

    const text = JSON.stringify(
      {
        merge_request: summarizeMrDetail(mr),
        changes: changes ? summarizeChanges(changes) : null,
        notes,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizeMrDetail(mr: GitlabMergeRequestDetail) {
  return {
    project_id: mr.project_id,
    mr_iid: mr.iid,
    title: mr.title,
    state: mr.state,
    draft: mr.draft,
    description: mr.description,
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    merge_status: mr.detailed_merge_status ?? mr.merge_status,
    has_conflicts: mr.has_conflicts ?? null,
    labels: mr.labels,
    assignees: mr.assignees.map((u) => u.username),
    reviewers: mr.reviewers.map((u) => u.username),
    author: mr.author.username,
    milestone: mr.milestone?.title ?? null,
    web_url: mr.web_url,
    user_notes_count: mr.user_notes_count,
    changes_count: mr.changes_count ?? null,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    merged_at: mr.merged_at,
    closed_at: mr.closed_at,
  };
}

function summarizeChanges(changes: GitlabMergeRequestChanges) {
  return {
    changes_count: changes.changes_count ?? null,
    overflow: changes.overflow ?? false,
    files: changes.changes.map(summarizeChange),
  };
}

function summarizeChange(change: GitlabMergeRequestChange) {
  return {
    old_path: change.old_path,
    new_path: change.new_path,
    new_file: change.new_file,
    deleted_file: change.deleted_file,
    renamed_file: change.renamed_file,
    diff: change.diff,
  };
}
