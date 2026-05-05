import { z } from "zod";
import type {
  GitlabClient,
  GitlabMergeRequestChange,
} from "../gitlab-client.js";
import { logTruncate } from "../util/log.js";
import { projectIdSchema } from "./shared.js";

export const getMrDiffInputShape = {
  project_id: projectIdSchema,
  mr_iid: z
    .number()
    .int()
    .positive()
    .describe(
      "Per-project iid of the MR (the number from the URL like '/-/merge_requests/3137'). NOT the global id.",
    ),
  max_total_bytes: z
    .number()
    .int()
    .positive()
    .max(2_000_000)
    .optional()
    .describe(
      "Soft cap on the SUM of all returned `diff` strings (default 80000). Truncation happens at FILE boundaries — once adding the next file would exceed this, iteration stops. Never truncates mid-hunk; partial diffs are useless to a reviewer.",
    ),
} as const;

const inputSchema = z.object(getMrDiffInputShape);
export type GetMrDiffInput = z.infer<typeof inputSchema>;

export const getMrDiffTool = {
  name: "get_mr_diff",
  config: {
    title: "Get the file changes (diff) of a GitLab MR",
    description: [
      "Fetch the diff of a single merge request, formatted for code review. READ-ONLY.",
      "",
      "Use this when the user wants to review code: 'show me the diff for MR 3137', 'what changed in this MR', 'walk me through the changes', 'review this'. The response is leaner than get_merge_request(include_diffs=true) — it omits MR metadata and returns only the per-file changes.",
      "Do NOT use this when the user only wants the description, status, or comments — that's get_merge_request. Do NOT use this if the user identified a single file by path — get_file_content is faster.",
      "",
      "Identify the target with project_id (numeric or 'group/repo' path) and mr_iid.",
      "",
      "TRUNCATION at file boundaries: once the running total of returned diff bytes plus the next file's diff would exceed max_total_bytes, iteration stops. Files that come after the cutoff are omitted entirely — `files_omitted` and `total_diff_bytes` reflect them, and `note` summarizes. Hunks are NEVER split. If a single file's diff exceeds max_total_bytes, NO files are returned (raise the cap or fetch the file with get_file_content).",
      "",
      "Returns: { project_id, mr_iid, files: [{ old_path, new_path, new_file, deleted_file, renamed_file, diff }], truncated, total_diff_bytes, returned_diff_bytes, files_omitted, note }.",
    ].join("\n"),
    inputSchema: getMrDiffInputShape,
  },
} as const;

interface SummarizedChange {
  old_path: string;
  new_path: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
  diff: string;
}

export function makeGetMrDiffHandler(client: GitlabClient) {
  return async (args: GetMrDiffInput) => {
    const maxTotalBytes = args.max_total_bytes ?? 80_000;
    const changes = await client.getMergeRequestChanges(
      args.project_id,
      args.mr_iid,
    );

    const files: SummarizedChange[] = [];
    let returnedBytes = 0;
    let totalBytes = 0;
    let filesOmitted = 0;
    let truncated = false;

    for (const change of changes.changes) {
      const fileBytes = Buffer.byteLength(change.diff ?? "", "utf8");
      totalBytes += fileBytes;
      if (truncated) {
        filesOmitted += 1;
        continue;
      }
      if (returnedBytes + fileBytes > maxTotalBytes) {
        truncated = true;
        filesOmitted += 1;
        continue;
      }
      files.push(summarizeChange(change));
      returnedBytes += fileBytes;
    }

    if (truncated) {
      logTruncate({
        tool: "get_mr_diff",
        originalBytes: totalBytes,
        returnedBytes,
        limit: maxTotalBytes,
        details: {
          mr_iid: args.mr_iid,
          files_returned: files.length,
          files_omitted: filesOmitted,
        },
      });
    }

    const note = truncated
      ? `[... ${filesOmitted} more file${filesOmitted === 1 ? "" : "s"} not shown, total diff is ${totalBytes} bytes ...]`
      : null;

    const text = JSON.stringify(
      {
        project_id: args.project_id,
        mr_iid: args.mr_iid,
        files,
        truncated,
        total_diff_bytes: totalBytes,
        returned_diff_bytes: returnedBytes,
        files_omitted: filesOmitted,
        note,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function summarizeChange(c: GitlabMergeRequestChange): SummarizedChange {
  return {
    old_path: c.old_path,
    new_path: c.new_path,
    new_file: c.new_file,
    deleted_file: c.deleted_file,
    renamed_file: c.renamed_file,
    diff: c.diff,
  };
}
