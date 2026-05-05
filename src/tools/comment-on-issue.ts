import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import {
  ensureWritesEnabled,
  nonEmptyMarkdownBody,
  projectIdSchema,
} from "./shared.js";

export const commentOnIssueInputShape = {
  project_id: projectIdSchema,
  issue_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the issue (the number from the URL like '/-/issues/355'). NOT the global id.",
    ),
  body: nonEmptyMarkdownBody.describe(
    "Markdown body of the comment. GitLab-flavored markdown is supported (mentions @user, references #123, fenced code, etc.). Empty or whitespace-only bodies are rejected.",
  ),
} as const;

const inputSchema = z.object(commentOnIssueInputShape);
export type CommentOnIssueInput = z.infer<typeof inputSchema>;

export const commentOnIssueTool = {
  name: "comment_on_issue",
  config: {
    title: "Comment on a GitLab issue",
    description: [
      "WRITES TO GITLAB: posts a comment (note) on a single issue. Visible to everyone with access to the issue and shows up immediately in the discussion timeline.",
      "",
      "Use this only when the user has explicitly asked to comment on, reply to, or leave a note on a SPECIFIC issue. Do NOT use this to summarize an issue back to the user in chat — that is just text output, not a GitLab action.",
      "",
      "Identify the target with project_id (numeric id preferred, or 'group/repo' path) and issue_iid (the per-project number).",
      "",
      "Body accepts GitLab-flavored markdown. The body is sent verbatim — do not add 'Posted by Claude' style preamble unless the user asked for it.",
      "",
      "IDEMPOTENCY: GitLab does NOT deduplicate comments. Calling this twice with the same body produces two identical comments. If the call returns an error, do not blindly retry — confirm the previous attempt actually failed (e.g. by reading the issue's notes) before sending again.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server. If writes are off, returns a clear error.",
    ].join("\n"),
    inputSchema: commentOnIssueInputShape,
  },
} as const;

export function makeCommentOnIssueHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (args: CommentOnIssueInput) => {
    ensureWritesEnabled(enableWrites, "comment_on_issue");
    const note = await client.createIssueNote(
      args.project_id,
      args.issue_iid,
      args.body,
    );
    const text = JSON.stringify({ ok: true, note }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}
