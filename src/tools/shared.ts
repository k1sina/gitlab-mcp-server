import { z } from "zod";
import type { GitlabNote } from "../gitlab-client.js";

export const projectIdSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe(
    "GitLab project identifier. Either the numeric project ID (e.g. 236) or the URL-encoded full path (e.g. 'jakota/support'). Numeric is preferred when known — see the list returned by search_projects or list_my_issues.",
  );

export const targetTypeSchema = z
  .enum(["issue", "merge_request"])
  .describe(
    "Whether the target is a GitLab issue or merge request. GitLab tracks time on both; pick the type that matches the iid you have.",
  );

export function ensureWritesEnabled(
  enableWrites: boolean,
  toolName: string,
): void {
  if (!enableWrites) {
    throw new Error(
      `Writes are disabled. Set GITLAB_ENABLE_WRITES=true on the MCP server to allow ${toolName}.`,
    );
  }
}

export const nonEmptyMarkdownBody = z
  .string()
  .min(1)
  .refine((s) => s.trim().length > 0, {
    message: "comment body cannot be empty or whitespace-only",
  });

export function summarizeNote(note: GitlabNote) {
  return {
    id: note.id,
    author: note.author.username,
    body: note.body,
    system: note.system,
    resolvable: note.resolvable,
    resolved: note.resolved ?? null,
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
}

export function filterNotes(
  notes: GitlabNote[],
  includeSystem: boolean,
): GitlabNote[] {
  return includeSystem ? notes : notes.filter((n) => !n.system);
}
