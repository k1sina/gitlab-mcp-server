import { z } from "zod";
import type { GitlabClient, GitlabMergeRequestRef } from "../gitlab-client.js";

export const listMyMergeRequestsInputShape = {
  state: z
    .enum(["opened", "closed", "merged", "all"])
    .optional()
    .describe(
      "Filter by MR state. 'opened' = active MRs awaiting review/merge (default), 'closed' = closed without merge, 'merged' = already merged, 'all' = every state. Omit for opened only.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Max number of MRs to return after deduplication (1-100). Defaults to 50. Note: each underlying GitLab call uses this same limit, so the dedup'd result is at most `limit` even though up to 2*limit are fetched.",
    ),
} as const;

const inputSchema = z.object(listMyMergeRequestsInputShape);
export type ListMyMergeRequestsInput = z.infer<typeof inputSchema>;

export const listMyMergeRequestsTool = {
  name: "list_my_merge_requests",
  config: {
    title: "List my GitLab merge requests",
    description: [
      "List GitLab merge requests where the authenticated user is either the assignee OR a requested reviewer, across the entire GitLab instance configured for this server.",
      "",
      "Use this when the user asks about: 'my MRs', 'merge requests', 'PRs', 'what do I need to review', 'what's waiting on me to merge', 'review queue', or wants a code-review-side overview of work.",
      "Do NOT use this for issues (use list_my_issues), and do NOT use it to list MRs the user authored but is not assigned to or reviewing — that's a different scope and not implemented.",
      "",
      "Each MR includes a `my_role` field — one of 'assignee' (you own the merge), 'reviewer' (you're requested to review), or 'both'. Use this to triage: 'reviewer' MRs are blocked on you to review; 'assignee' MRs are blocked on you to merge.",
      "",
      "Returns: project_id, mr_iid, title, state, my_role, source_branch, target_branch, draft, merge_status, labels, assignees, reviewers, author, milestone, web_url, timestamps. The full description, diffs, and comments are NOT included — call get_merge_request for those.",
      "",
      "By default returns only OPENED MRs. Pass state='merged' or state='all' explicitly when the user asks about historical or merged work.",
    ].join("\n"),
    inputSchema: listMyMergeRequestsInputShape,
  },
} as const;

type Role = "assignee" | "reviewer" | "both";

export function makeListMyMergeRequestsHandler(
  client: GitlabClient,
  myUsername: string,
) {
  return async (args: ListMyMergeRequestsInput) => {
    const state = args.state ?? "opened";
    const perPage = args.limit ?? 50;

    const [assigned, reviewing] = await Promise.all([
      client.listMergeRequestsAssignedToMe({ state, perPage }),
      client.listMergeRequestsForReviewer(myUsername, { state, perPage }),
    ]);

    const byId = new Map<number, { mr: GitlabMergeRequestRef; role: Role }>();
    for (const mr of assigned) {
      byId.set(mr.id, { mr, role: "assignee" });
    }
    for (const mr of reviewing) {
      const existing = byId.get(mr.id);
      if (existing) {
        existing.role = "both";
      } else {
        byId.set(mr.id, { mr, role: "reviewer" });
      }
    }

    const all = Array.from(byId.values())
      .sort((a, b) => b.mr.updated_at.localeCompare(a.mr.updated_at))
      .slice(0, perPage)
      .map(({ mr, role }) => summarizeMergeRequest(mr, role));

    const text =
      all.length === 0
        ? "No merge requests found for the current user with the given filters."
        : JSON.stringify({ count: all.length, merge_requests: all }, null, 2);

    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizeMergeRequest(mr: GitlabMergeRequestRef, role: Role) {
  return {
    project_id: mr.project_id,
    mr_iid: mr.iid,
    title: mr.title,
    state: mr.state,
    my_role: role,
    draft: mr.draft,
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    merge_status: mr.detailed_merge_status ?? mr.merge_status,
    labels: mr.labels,
    assignees: mr.assignees.map((u) => u.username),
    reviewers: mr.reviewers.map((u) => u.username),
    author: mr.author.username,
    milestone: mr.milestone?.title ?? null,
    web_url: mr.web_url,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    merged_at: mr.merged_at,
    closed_at: mr.closed_at,
  };
}
