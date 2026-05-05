import { z } from "zod";
import type {
  GitlabClient,
  GitlabIssueDetail,
  GitlabWorkItemStatus,
} from "../gitlab-client.js";
import { filterNotes, projectIdSchema, summarizeNote } from "./shared.js";

export const getIssueInputShape = {
  project_id: projectIdSchema,
  issue_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "The issue's per-project iid — the number you see in URLs like /-/issues/42 (NOT the global `id`). list_my_issues returns this as `issue_iid`.",
    ),
  include_notes: z
    .boolean()
    .optional()
    .describe(
      "Whether to fetch comments (notes). Default true. Set to false for a faster call when you only need the issue body.",
    ),
  include_system_notes: z
    .boolean()
    .optional()
    .describe(
      "Whether to include GitLab system-generated notes (label changes, status changes, mentions, etc). Default false. System notes are usually noise; turn on only when reconstructing a timeline.",
    ),
} as const;

const inputSchema = z.object(getIssueInputShape);
export type GetIssueInput = z.infer<typeof inputSchema>;

export const getIssueTool = {
  name: "get_issue",
  config: {
    title: "Get GitLab issue with description, status, and comments",
    description: [
      "Fetch the full body and discussion of a single GitLab issue — the description text, current state, workflow status (Work Item Status widget), assignees, labels, milestone, and (by default) all human comments in chronological order.",
      "",
      "Use this when the user has identified a specific issue (by URL, iid, or name from list_my_issues) and wants the actual content: 'what does issue 42 say', 'show me the description', 'what's the latest comment on...', 'summarize the discussion'.",
      "Do NOT use this just to discover which issues exist — use list_my_issues for that. Do NOT use this for merge requests — use get_merge_request.",
      "",
      "Identifying an issue requires BOTH project_id AND issue_iid:",
      "- project_id: numeric project id (preferred) or 'group/repo' path",
      "- issue_iid: the per-project number from the URL like '/-/issues/42'",
      "",
      "By default, system-generated notes (label/state/mention bookkeeping) are filtered out — they're rarely useful to a reader. Pass include_system_notes=true if you need a full audit timeline.",
      "",
      "The `status` field reflects GitLab's Work Item Status widget (e.g. 'To do', 'In progress', 'Done'). It is `null` for tickets in projects that don't use the field.",
      "",
      "Returns: { issue: { ...full detail including status... }, notes: [ ...filtered comments in ascending chronological order... ] }.",
    ].join("\n"),
    inputSchema: getIssueInputShape,
  },
} as const;

export function makeGetIssueHandler(client: GitlabClient) {
  return async (args: GetIssueInput) => {
    const includeNotes = args.include_notes ?? true;
    const includeSystem = args.include_system_notes ?? false;

    const [issue, rawNotes] = await Promise.all([
      client.getIssue(args.project_id, args.issue_iid),
      includeNotes
        ? client.listIssueNotes(args.project_id, args.issue_iid)
        : Promise.resolve([]),
    ]);

    // Status fetch piggybacks on the issue's resolved web_url / references —
    // we run it AFTER the issue load (need the project path) but it's a
    // single round trip. Network failures here shouldn't sink the whole
    // call: degrade gracefully to status=null.
    const path = projectPath(issue);
    let status: GitlabWorkItemStatus | null = null;
    if (path) {
      try {
        const map = await client.fetchWorkItemStatuses([
          { projectPath: path, iid: issue.iid },
        ]);
        status = map.get(`${path}#${issue.iid}`) ?? null;
      } catch {
        status = null;
      }
    }

    const notes = includeNotes
      ? filterNotes(rawNotes, includeSystem).map(summarizeNote)
      : null;

    const text = JSON.stringify(
      {
        issue: summarizeIssueDetail(issue, status),
        notes,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function projectPath(issue: GitlabIssueDetail): string | null {
  const full = issue.references?.full;
  if (full) {
    const idx = full.indexOf("#");
    return idx >= 0 ? full.slice(0, idx) : full;
  }
  const m = issue.web_url.match(/^https?:\/\/[^/]+\/(.+?)\/-\//);
  return m ? m[1]! : null;
}

function summarizeIssueDetail(
  issue: GitlabIssueDetail,
  status: GitlabWorkItemStatus | null,
) {
  return {
    project_id: issue.project_id,
    issue_iid: issue.iid,
    title: issue.title,
    state: issue.state,
    status: status ? { name: status.name, color: status.color } : null,
    description: issue.description,
    labels: issue.labels,
    assignees: issue.assignees.map((u) => u.username),
    author: issue.author.username,
    milestone: issue.milestone?.title ?? null,
    due_date: issue.due_date,
    web_url: issue.web_url,
    user_notes_count: issue.user_notes_count,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    closed_by: issue.closed_by?.username ?? null,
  };
}
