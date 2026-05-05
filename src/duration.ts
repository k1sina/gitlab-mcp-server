// GitLab duration units, in seconds. Matches GitLab defaults: week=5d, day=8h.
const UNIT_SECONDS: Record<string, number> = {
  w: 5 * 8 * 3600,
  d: 8 * 3600,
  h: 3600,
  m: 60,
  s: 1,
};

const FULL_RE = /^(?:\d+\s*[wdhms]\s*)+$/;
const TOKEN_RE = /(\d+)\s*([wdhms])/g;

export function parseDuration(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("duration must not be empty");
  }
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const body = trimmed.replace(/^[-+]/, "").trim();
  if (!body || !FULL_RE.test(body)) {
    throw new Error(
      `invalid duration: ${JSON.stringify(input)} (expected forms like '1h30m', '45m', '2h', '1w 2d')`,
    );
  }

  let total = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    total += Number(m[1]) * UNIT_SECONDS[m[2]!]!;
  }
  if (total === 0) {
    throw new Error(`invalid duration: ${JSON.stringify(input)} parsed to zero`);
  }
  return sign * total;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0s";
  if (seconds === 0) return "0m";
  const sign = seconds < 0 ? "-" : "";
  let s = Math.abs(Math.trunc(seconds));
  const parts: string[] = [];
  for (const unit of ["w", "d", "h", "m", "s"] as const) {
    const size = UNIT_SECONDS[unit]!;
    if (s >= size) {
      const n = Math.floor(s / size);
      s -= n * size;
      parts.push(`${n}${unit}`);
    }
  }
  return sign + (parts.length ? parts.join(" ") : "0m");
}
