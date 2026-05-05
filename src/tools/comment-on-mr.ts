import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import {
  ensureWritesEnabled,
  nonEmptyMarkdownBody,
  projectIdSchema,
} from "./shared.js";

export const commentOnMrInputShape = {
  project_id: projectIdSchema,
  mr_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the MR (the number from the URL like '/-/merge_requests/3137'). NOT the global id.",
    ),
  body: nonEmptyMarkdownBody.describe(
    "Markdown body of the comment. GitLab-flavored markdown is supported. Empty or whitespace-only bodies are rejected.",
  ),
} as const;

const inputSchema = z.object(commentOnMrInputShape);
export type CommentOnMrInput = z.infer<typeof inputSchema>;

export const commentOnMrTool = {
  name: "comment_on_mr",
  config: {
    title: "Comment on a GitLab merge request",
    description: [
      "WRITES TO GITLAB: posts a comment (note) on a single merge request. Visible to everyone with access to the MR and shows up immediately in the MR discussion.",
      "",
      "Use this only when the user has explicitly asked to comment on, reply to, or leave a note on a SPECIFIC MR. Do NOT use this for review-style line comments on diffs (different endpoint, not implemented). Do NOT use this to summarize an MR back to the user in chat.",
      "",
      "Identify the target with project_id (numeric id preferred, or 'group/repo' path) and mr_iid (the per-project number).",
      "",
      "Body accepts GitLab-flavored markdown. The body is sent verbatim.",
      "",
      "IDEMPOTENCY: GitLab does NOT deduplicate comments. Calling this twice with the same body produces two identical comments. If the call returns an error, do not blindly retry — confirm the previous attempt failed before sending again.",
      "",
      "DISABLED BY DEFAULT: requires GITLAB_ENABLE_WRITES=true on the server.",
    ].join("\n"),
    inputSchema: commentOnMrInputShape,
  },
} as const;

export function makeCommentOnMrHandler(
  client: GitlabClient,
  enableWrites: boolean,
) {
  return async (args: CommentOnMrInput) => {
    ensureWritesEnabled(enableWrites, "comment_on_mr");
    const note = await client.createMergeRequestNote(
      args.project_id,
      args.mr_iid,
      args.body,
    );
    const text = JSON.stringify({ ok: true, note }, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}
