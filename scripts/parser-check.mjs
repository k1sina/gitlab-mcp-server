// Unit-style sanity check for duration + time-note parsers. No GitLab calls.
import { parseDuration, formatDuration } from "../dist/duration.js";
import { parseTimeNote } from "../dist/time-notes.js";

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}  got=${JSON.stringify(actual)}  want=${JSON.stringify(expected)}`);
}

// parseDuration
check("1h30m", parseDuration("1h30m"), 5400);
check("1h 30m", parseDuration("1h 30m"), 5400);
check("30m", parseDuration("30m"), 1800);
check("2h", parseDuration("2h"), 7200);
check("1d", parseDuration("1d"), 8 * 3600);
check("1w", parseDuration("1w"), 5 * 8 * 3600);
check("-30m", parseDuration("-30m"), -1800);
check("1w 2d 3h 4m 5s", parseDuration("1w 2d 3h 4m 5s"), 5*8*3600 + 2*8*3600 + 3*3600 + 4*60 + 5);

// formatDuration
check("fmt 5400", formatDuration(5400), "1h 30m");
check("fmt 1800", formatDuration(1800), "30m");
check("fmt 0", formatDuration(0), "0m");
check("fmt -1800", formatDuration(-1800), "-30m");

// parseTimeNote — common GitLab system note shapes
check(
  "added 1h 30m of time spent at 2026-04-28",
  parseTimeNote("added 1h 30m of time spent at 2026-04-28"),
  { sign: 1, seconds: 5400, durationText: "1h 30m", workDate: "2026-04-28" },
);
check(
  "added 30m of time spent at 2026-04-25",
  parseTimeNote("added 30m of time spent at 2026-04-25"),
  { sign: 1, seconds: 1800, durationText: "30m", workDate: "2026-04-25" },
);
check(
  "subtracted 1h of time spent at 2026-04-26",
  parseTimeNote("subtracted 1h of time spent at 2026-04-26"),
  { sign: -1, seconds: -3600, durationText: "1h", workDate: "2026-04-26" },
);
check(
  "added 2h of time spent (no date)",
  parseTimeNote("added 2h of time spent"),
  { sign: 1, seconds: 7200, durationText: "2h", workDate: null },
);
check(
  "added 4h of time spent at 2026-04-24 12:00:00 +0200 (real GitLab body)",
  parseTimeNote("added 4h of time spent at 2026-04-24 12:00:00 +0200"),
  { sign: 1, seconds: 14400, durationText: "4h", workDate: "2026-04-24" },
);
check(
  "subtracted 30m of time spent at 2026-04-25 09:30:00 +0000",
  parseTimeNote("subtracted 30m of time spent at 2026-04-25 09:30:00 +0000"),
  { sign: -1, seconds: -1800, durationText: "30m", workDate: "2026-04-25" },
);
check(
  "non-matching system note returns null",
  parseTimeNote("changed title from foo to bar"),
  null,
);
check(
  "removed time spent (the reset note) returns null",
  parseTimeNote("removed time spent"),
  null,
);

// invalid duration should throw
let threw = false;
try { parseDuration("blarg"); } catch { threw = true; }
check("parseDuration throws on garbage", threw, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
