import { z } from "zod";
import type { GitlabClient } from "../gitlab-client.js";
import { stripAnsi } from "../util/ansi.js";
import { logTruncate } from "../util/log.js";
import { projectIdSchema } from "./shared.js";

export const getJobLogInputShape = {
  project_id: projectIdSchema,
  job_id: z
    .number()
    .int()
    .positive()
    .describe(
      "Numeric job id (NOT a job name). get_pipeline_jobs returns this as `id`.",
    ),
  max_bytes: z
    .number()
    .int()
    .positive()
    .max(2_000_000)
    .optional()
    .describe(
      "Max bytes of log to return (default 100000 = ~100KB). Counted AFTER ANSI escape sequences are stripped, so the budget reflects what the model actually sees.",
    ),
  tail: z
    .boolean()
    .optional()
    .describe(
      "If true (default) and the log is larger than max_bytes, return the LAST max_bytes (debugging usually cares about the end). If false, return the FIRST max_bytes.",
    ),
} as const;

const inputSchema = z.object(getJobLogInputShape);
export type GetJobLogInput = z.infer<typeof inputSchema>;

export const getJobLogTool = {
  name: "get_job_log",
  config: {
    title: "Read the log (trace) of a single CI job",
    description: [
      "Fetch the trace / log of a single CI job, with ANSI color codes stripped. READ-ONLY.",
      "",
      "Use this when the user wants to see WHY a job failed: 'what does the log say', 'show me the test failure', 'why did the deploy step fail'. Use get_pipeline_jobs first to find the job_id.",
      "Do NOT use this to list jobs (that's get_pipeline_jobs). Do NOT use this to read source files (get_file_content).",
      "",
      "Identify with project_id and job_id (numeric). The tool issues TWO calls in parallel — one for the log text, one for the job status — so the response includes both without a separate round trip.",
      "",
      "TRUNCATION: when the cleaned log exceeds max_bytes (default 100000):",
      "  - tail=true (default): returns the LAST max_bytes, prepended with '[... showing last N bytes of M total ...]'. Right for debugging — failure is usually at the end.",
      "  - tail=false: returns the FIRST max_bytes, appended with '[... showing first N bytes of M total ...]'. Right for inspecting build setup output.",
      "Byte counts are measured AFTER ANSI stripping, so the budget reflects what you actually see.",
      "",
      "Returns: { job_id, status, log, truncated, total_bytes, returned_bytes, tailed }.",
    ].join("\n"),
    inputSchema: getJobLogInputShape,
  },
} as const;

export function makeGetJobLogHandler(client: GitlabClient) {
  return async (args: GetJobLogInput) => {
    const maxBytes = args.max_bytes ?? 100_000;
    const tailed = args.tail ?? true;

    const [job, rawLog] = await Promise.all([
      client.getJob(args.project_id, args.job_id),
      client.getJobLog(args.project_id, args.job_id),
    ]);

    const cleaned = stripAnsi(rawLog);
    const totalBytes = Buffer.byteLength(cleaned, "utf8");

    let log: string;
    let truncated = false;
    let returnedBytes = totalBytes;

    if (totalBytes > maxBytes) {
      truncated = true;
      returnedBytes = maxBytes;
      const buf = Buffer.from(cleaned, "utf8");
      if (tailed) {
        const slice = buf.subarray(buf.byteLength - maxBytes).toString("utf8");
        log =
          `[... showing last ${maxBytes} bytes of ${totalBytes} total ...]\n` +
          slice;
      } else {
        const slice = buf.subarray(0, maxBytes).toString("utf8");
        log =
          slice +
          `\n[... showing first ${maxBytes} bytes of ${totalBytes} total ...]`;
      }
      logTruncate({
        tool: "get_job_log",
        originalBytes: totalBytes,
        returnedBytes,
        limit: maxBytes,
        details: { job_id: args.job_id, tailed },
      });
    } else {
      log = cleaned;
    }

    const text = JSON.stringify(
      {
        job_id: args.job_id,
        status: job.status,
        log,
        truncated,
        total_bytes: totalBytes,
        returned_bytes: returnedBytes,
        tailed,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}
