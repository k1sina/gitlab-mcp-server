import { parseDuration } from "./duration.js";

export interface ParsedTimeNote {
  sign: 1 | -1;
  seconds: number;
  durationText: string;
  workDate: string | null;
}

// GitLab emits bodies like:
//   "added 4h of time spent at 2026-04-24 12:00:00 +0200"
//   "added 30m of time spent at 2026-04-25"
//   "subtracted 1h of time spent"
// We capture only the date portion; any trailing time-of-day / tz is allowed
// but ignored. The capture is also tolerant of an optional trailing period.
const TIME_NOTE_RE =
  /^(added|subtracted)\s+(.+?)\s+of time spent(?:\s+at\s+(\d{4}-\d{2}-\d{2})(?:[\sT][^.]*)?)?\.?$/i;

export function parseTimeNote(body: string): ParsedTimeNote | null {
  const m = TIME_NOTE_RE.exec(body.trim());
  if (!m) return null;
  const verb = m[1]!.toLowerCase();
  const durationText = m[2]!;
  const workDate = m[3] ?? null;
  let parsed: number;
  try {
    parsed = parseDuration(durationText);
  } catch {
    return null;
  }
  const sign: 1 | -1 = verb === "subtracted" ? -1 : 1;
  return {
    sign,
    seconds: sign * Math.abs(parsed),
    durationText,
    workDate,
  };
}
