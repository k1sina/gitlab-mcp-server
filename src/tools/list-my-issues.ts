import { z } from "zod";
import type {
  GitlabClient,
  GitlabIssueRef,
  GitlabWorkItemStatus,
} from "../gitlab-client.js";

export const listMyIssuesInputShape = {
  state: z
    .enum(["opened", "closed", "all"])
    .optional()
    .describe(
      "Filter by issue state. 'opened' = currently active issues (default), 'closed' = resolved issues, 'all' = both. Omit for opened only.",
    ),
  status: z
    .array(z.string())
    .optional()
    .describe(
      "Filter to issues whose workflow status (GitLab's Work Item Status widget) is one of these names. " +
        "When omitted, the server's configured `actionable` defaults are used (typically ['To do', 'In progress']). " +
        "Pass [] to disable the filter and see every status. " +
        "Issues without a status widget (e.g. projects that don't use the field) are ALWAYS included regardless of this filter. " +
        "When `state` is set to 'closed' or 'all' the default is also dropped (closed/audit views shouldn't be triaged).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max number of issues to return (1-100). Defaults to 50."),
} as const;

const inputSchema = z.object(listMyIssuesInputShape);
export type ListMyIssuesInput = z.infer<typeof inputSchema>;

export const listMyIssuesTool = {
  name: "list_my_issues",
  config: {
    title: "List my GitLab issues (actionable by default)",
    description: [
      "List GitLab issues assigned to the authenticated user across the entire GitLab instance configured for this server.",
      "",
      "Use this when the user asks about: 'my issues', 'what's on my plate', 'tickets assigned to me', 'what should I work on', or wants a backlog overview.",
      "Do NOT use this to find issues NOT assigned to the user (use a project-scoped issue search instead, once available), and do NOT use it for merge requests (use list_my_merge_requests).",
      "",
      "ACTIONABLE-BY-DEFAULT: by default returns only tickets whose workflow status (GitLab's Work Item Status widget) is one of the server's configured 'actionable' statuses (typically 'To do' / 'In progress'). Tickets in other statuses (e.g. 'Done', 'In Review') are hidden unless the caller passes a wider `status` filter or asks for closed / all state.",
      "Tickets without a workflow status (projects that don't use the field) are ALWAYS included regardless of the status filter — losing visibility on those would be worse than the noise.",
      "Pass `status: []` to disable the status filter and see every active ticket. Pass `status: ['<custom>']` to filter to specific statuses.",
      "",
      "Returns a compact list with: project_id, issue iid, title, state, **status**, labels, web_url, due date, milestone, and timestamps. The full description and comments are NOT included — call get_issue with project_id + issue_iid for that.",
      "",
      "By default returns only OPENED issues. Pass state='closed' or state='all' explicitly when the user asks about completed or historical work — doing so also drops the status default.",
    ].join("\n"),
    inputSchema: listMyIssuesInputShape,
  },
} as const;

export function makeListMyIssuesHandler(
  client: GitlabClient,
  defaultActionableStatuses: readonly string[],
) {
  return async (args: ListMyIssuesInput) => {
    const state = args.state ?? "opened";
    const issues = await client.listMyIssues({
      state,
      perPage: args.limit ?? 50,
    });

    const effectiveStatus = resolveStatusFilter(
      args,
      state,
      defaultActionableStatuses,
    );

    let statusByKey: Map<string, GitlabWorkItemStatus | null> | null = null;
    let kept = issues;
    if (effectiveStatus !== null && issues.length > 0) {
      const items: Array<{ projectPath: string; iid: number }> = [];
      for (const issue of issues) {
        const path = projectPath(issue);
        if (path) items.push({ projectPath: path, iid: issue.iid });
      }
      statusByKey = await client.fetchWorkItemStatuses(items);
      const wanted = new Set(effectiveStatus);
      kept = issues.filter((issue) => {
        const path = projectPath(issue);
        if (!path) return true; // can't classify → keep (matches null-status policy)
        const status = statusByKey!.get(`${path}#${issue.iid}`) ?? null;
        if (status === null) return true; // widget absent → support-project / unset → always keep
        return wanted.has(status.name);
      });
    }

    const summary = kept.map((issue) => summarizeIssue(issue, statusByKey));
    const text =
      summary.length === 0
        ? "No issues found for the current user with the given filters."
        : JSON.stringify(
            {
              count: summary.length,
              applied_status_filter: effectiveStatus,
              issues: summary,
            },
            null,
            2,
          );
    return {
      content: [{ type: "text" as const, text }],
    };
  };
}

/**
 * Decide whether to apply a status filter and what the wanted set is.
 * Returns null when no filter should be applied (and the GraphQL call can
 * be skipped entirely).
 */
function resolveStatusFilter(
  args: ListMyIssuesInput,
  state: "opened" | "closed" | "all",
  defaultActionableStatuses: readonly string[],
): string[] | null {
  // Caller passed status explicitly: honor it, including the empty-array
  // disable-the-filter signal.
  if (args.status !== undefined) {
    return args.status.length === 0 ? null : args.status;
  }
  // No explicit status. Apply the actionable default only when looking at
  // currently-opened tickets — closed/all is an audit view, not triage.
  if (state !== "opened") return null;
  // Server configured an empty actionable list → no default filter.
  if (defaultActionableStatuses.length === 0) return null;
  return [...defaultActionableStatuses];
}

function projectPath(issue: GitlabIssueRef): string | null {
  const full = issue.references?.full;
  if (full) {
    const idx = full.indexOf("#");
    return idx >= 0 ? full.slice(0, idx) : full;
  }
  // Fallback: parse `https://host/{path}/-/{issues|work_items}/{iid}` from web_url.
  const m = issue.web_url.match(/^https?:\/\/[^/]+\/(.+?)\/-\//);
  return m ? m[1]! : null;
}

function summarizeIssue(
  issue: GitlabIssueRef,
  statusByKey: Map<string, GitlabWorkItemStatus | null> | null,
) {
  let status: { name: string; color: string } | null = null;
  if (statusByKey) {
    const path = projectPath(issue);
    if (path) {
      const s = statusByKey.get(`${path}#${issue.iid}`);
      if (s) status = { name: s.name, color: s.color };
    }
  }
  return {
    project_id: issue.project_id,
    issue_iid: issue.iid,
    title: issue.title,
    state: issue.state,
    status,
    labels: issue.labels,
    web_url: issue.web_url,
    due_date: issue.due_date,
    milestone: issue.milestone?.title ?? null,
    author: issue.author.username,
    updated_at: issue.updated_at,
    created_at: issue.created_at,
  };
}
