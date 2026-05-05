import { z } from "zod";
import type {
  GitlabClient,
  GitlabIssueRef,
  GitlabMergeRequestRef,
  GitlabNote,
} from "../gitlab-client.js";
import { formatDuration } from "../duration.js";
import { parseTimeNote } from "../time-notes.js";

export const reportTimeInputShape = {
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Inclusive start date in YYYY-MM-DD. Defaults to 7 days before today. Time is grouped by the work date GitLab records on each entry, not the day the entry was created.",
    ),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Inclusive end date in YYYY-MM-DD. Defaults to today.",
    ),
} as const;

const inputSchema = z.object(reportTimeInputShape);
export type ReportTimeInput = z.infer<typeof inputSchema>;

export const reportTimeTool = {
  name: "report_time",
  config: {
    title: "Daily timesheet of time you logged on GitLab",
    description: [
      "Build a per-day timesheet of time YOU logged across GitLab issues and merge requests, with a per-ticket breakdown for each day. READ-ONLY.",
      "",
      "Use this when the user asks: 'how much did I work this week', 'show me my time logs by day', 'what did I log on Tuesday', 'weekly timesheet', 'break down my hours per ticket'.",
      "Do NOT use this for the cumulative total on a single issue (use get_time), and do NOT use it to add or remove entries (log_time / delete_time).",
      "",
      "Range: optional `from` and `to` (YYYY-MM-DD). Default is the last 7 days inclusive of today.",
      "",
      "How it works (so you can debug surprising results):",
      "- Scans GitLab issues and MRs where you are either the assignee or the author and that were updated since `from`.",
      "- For each, reads the note timeline and picks out 'added/subtracted X of time spent at <date>' system notes authored by you.",
      "- Groups entries by the work date in the note (or the note's creation date if no work date is set), within [from, to].",
      "",
      "LIMITATION: this only sees time you logged on issues/MRs you are assigned to or authored. If you logged time on someone else's ticket and you are neither, those entries are NOT included. This covers the common case but not every case.",
      "",
      "Returns: { range, days: [{ date, total_seconds, total_human, entries: [{ target_type, project_id, iid, title, web_url, duration_seconds, duration_human, logged_at }] }], grand_total_seconds, grand_total_human }.",
    ].join("\n"),
    inputSchema: reportTimeInputShape,
  },
} as const;

interface ReportEntry {
  target_type: "issue" | "merge_request";
  project_id: number;
  iid: number;
  title: string;
  web_url: string;
  duration_seconds: number;
  duration_human: string;
  logged_at: string;
  work_date: string;
}

export function makeReportTimeHandler(client: GitlabClient, myUsername: string) {
  return async (args: ReportTimeInput) => {
    const { from, to } = resolveRange(args);
    const updatedAfter = `${from}T00:00:00Z`;

    const [assignedIssues, authoredIssues, assignedMrs, authoredMrs] =
      await Promise.all([
        client.listIssuesForReport("assigned_to_me", updatedAfter),
        client.listIssuesForReport("created_by_me", updatedAfter),
        client.listMergeRequestsForReport("assigned_to_me", updatedAfter),
        client.listMergeRequestsForReport("created_by_me", updatedAfter),
      ]);

    type Target =
      | { kind: "issue"; ref: GitlabIssueRef }
      | { kind: "merge_request"; ref: GitlabMergeRequestRef };

    const byKey = new Map<string, Target>();
    for (const i of [...assignedIssues, ...authoredIssues]) {
      byKey.set(`issue:${i.id}`, { kind: "issue", ref: i });
    }
    for (const m of [...assignedMrs, ...authoredMrs]) {
      byKey.set(`mr:${m.id}`, { kind: "merge_request", ref: m });
    }

    const targets = Array.from(byKey.values());
    const allNotes = await fetchNotesChunked(client, targets, 10);

    const entries: ReportEntry[] = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      const notes = allNotes[i]!;
      for (const note of notes) {
        if (!note.system) continue;
        if (note.author.username !== myUsername) continue;
        const parsed = parseTimeNote(note.body);
        if (!parsed) continue;
        const workDate = parsed.workDate ?? note.created_at.slice(0, 10);
        if (workDate < from || workDate > to) continue;
        entries.push({
          target_type: t.kind === "issue" ? "issue" : "merge_request",
          project_id: t.ref.project_id,
          iid: t.ref.iid,
          title: t.ref.title,
          web_url: t.ref.web_url,
          duration_seconds: parsed.seconds,
          duration_human: formatDuration(parsed.seconds),
          logged_at: note.created_at,
          work_date: workDate,
        });
      }
    }

    const byDay = new Map<string, ReportEntry[]>();
    for (const e of entries) {
      const list = byDay.get(e.work_date) ?? [];
      list.push(e);
      byDay.set(e.work_date, list);
    }

    const days = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => {
        list.sort((a, b) => a.logged_at.localeCompare(b.logged_at));
        const total = list.reduce((acc, e) => acc + e.duration_seconds, 0);
        return {
          date,
          total_seconds: total,
          total_human: formatDuration(total),
          entries: list.map((e) => ({
            target_type: e.target_type,
            project_id: e.project_id,
            iid: e.iid,
            title: e.title,
            web_url: e.web_url,
            duration_seconds: e.duration_seconds,
            duration_human: e.duration_human,
            logged_at: e.logged_at,
          })),
        };
      });

    const grandTotal = days.reduce((acc, d) => acc + d.total_seconds, 0);

    const text = JSON.stringify(
      {
        range: { from, to },
        grand_total_seconds: grandTotal,
        grand_total_human: formatDuration(grandTotal),
        days,
      },
      null,
      2,
    );
    return { content: [{ type: "text" as const, text }] };
  };
}

function resolveRange(args: ReportTimeInput): { from: string; to: string } {
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const sevenAgo = new Date(today);
  sevenAgo.setUTCDate(today.getUTCDate() - 7);
  const isoSevenAgo = sevenAgo.toISOString().slice(0, 10);
  const from = args.from ?? isoSevenAgo;
  const to = args.to ?? isoToday;
  if (from > to) {
    throw new Error(`'from' (${from}) must be on or before 'to' (${to}).`);
  }
  return { from, to };
}

async function fetchNotesChunked(
  client: GitlabClient,
  targets: Array<
    | { kind: "issue"; ref: GitlabIssueRef }
    | { kind: "merge_request"; ref: GitlabMergeRequestRef }
  >,
  chunkSize: number,
): Promise<GitlabNote[][]> {
  const out: GitlabNote[][] = new Array(targets.length);
  for (let i = 0; i < targets.length; i += chunkSize) {
    const slice = targets.slice(i, i + chunkSize);
    const results = await Promise.all(
      slice.map((t) =>
        t.kind === "issue"
          ? client.listIssueNotes(t.ref.project_id, t.ref.iid)
          : client.listMergeRequestNotes(t.ref.project_id, t.ref.iid),
      ),
    );
    for (let j = 0; j < slice.length; j++) {
      out[i + j] = results[j]!;
    }
  }
  return out;
}
