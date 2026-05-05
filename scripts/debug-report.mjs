// Debug script: hits GitLab directly (no MCP), fetches notes for a target,
// classifies system notes, and dry-runs parseTimeNote against each one.
// Goal: explain why report_time misses entries the user knows are there.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTimeNote } from "../dist/time-notes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const env = { ...process.env };
try {
  for (const line of readFileSync(resolve(repoRoot, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!env[m[1]]) env[m[1]] = v;
  }
} catch {}

const baseUrl = (env.GITLAB_URL ?? "https://gitlab.com/api/v4").replace(/\/+$/, "");
const token = env.GITLAB_TOKEN;
if (!token) throw new Error("GITLAB_TOKEN missing");

async function gl(path) {
  const r = await fetch(`${baseUrl}${path}`, {
    headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`${r.status} ${r.statusText} for ${path}\n${body.slice(0, 500)}`);
  }
  return r.json();
}

// Edit these or override via env (DEBUG_PROJECT / DEBUG_ISSUE_IID) to point
// the probe at a real ticket on your instance — useful when the server's
// time-tracking parser misses entries you know are there.
const PROJECT = env.DEBUG_PROJECT ? Number(env.DEBUG_PROJECT) : 1;
const ISSUE_IID = env.DEBUG_ISSUE_IID ? Number(env.DEBUG_ISSUE_IID) : 1;

const me = await gl("/user");
console.log(`current user: id=${me.id} username=${me.username} name=${me.name}`);

const issue = await gl(`/projects/${PROJECT}/issues/${ISSUE_IID}`);
console.log(
  `\nissue ${PROJECT}/${ISSUE_IID}: ${issue.title}`,
);
console.log(
  `  updated_at=${issue.updated_at}  total_time_spent=${issue.time_stats?.total_time_spent ?? "?"}  user_notes_count=${issue.user_notes_count}`,
);

// Pull every page of notes (in case there are >100).
let page = 1;
const allNotes = [];
while (true) {
  const batch = await gl(
    `/projects/${PROJECT}/issues/${ISSUE_IID}/notes?sort=asc&per_page=100&page=${page}`,
  );
  allNotes.push(...batch);
  if (batch.length < 100) break;
  page += 1;
  if (page > 20) break; // safety
}
console.log(`\nfetched ${allNotes.length} notes total`);

const systemNotes = allNotes.filter((n) => n.system);
const userNotes = allNotes.filter((n) => !n.system);
console.log(`  ${systemNotes.length} system, ${userNotes.length} user`);

// Buckets we care about
const timeNotes = [];
const timeLikeButUnparsed = [];
const otherSystemSamples = [];

for (const n of systemNotes) {
  const parsed = parseTimeNote(n.body);
  if (parsed) {
    timeNotes.push({ note: n, parsed });
  } else if (/time spent/i.test(n.body) || /^added \d|^subtracted \d/i.test(n.body)) {
    timeLikeButUnparsed.push(n);
  } else if (otherSystemSamples.length < 5) {
    otherSystemSamples.push(n);
  }
}

console.log(`\n=== time-tracking system notes parsed: ${timeNotes.length} ===`);
for (const { note, parsed } of timeNotes) {
  console.log(
    `  [${note.created_at}]  author=${note.author.username}  body=${JSON.stringify(note.body)}  parsed=${JSON.stringify(parsed)}`,
  );
}

if (timeLikeButUnparsed.length) {
  console.log(
    `\n=== time-LIKE notes that DID NOT parse (${timeLikeButUnparsed.length}) — possible regex miss ===`,
  );
  for (const n of timeLikeButUnparsed) {
    console.log(
      `  [${n.created_at}]  author=${n.author.username}  body=${JSON.stringify(n.body)}`,
    );
  }
}

console.log("\n=== sample of other system notes (for reference) ===");
for (const n of otherSystemSamples) {
  console.log(`  [${n.created_at}]  ${JSON.stringify(n.body).slice(0, 140)}`);
}

// Summary: what report_time would see
const myTimeNotes = timeNotes.filter(
  ({ note }) => note.author.username === me.username,
);
console.log(
  `\n=== from report_time's perspective ===\n  authored-by-${me.username}: ${myTimeNotes.length} time entries`,
);
const fourteenAgo = new Date();
fourteenAgo.setUTCDate(fourteenAgo.getUTCDate() - 14);
const fromDate = fourteenAgo.toISOString().slice(0, 10);
const inWindow = myTimeNotes.filter(({ note, parsed }) => {
  const work = parsed.workDate ?? note.created_at.slice(0, 10);
  return work >= fromDate;
});
console.log(`  in last 14 days (>= ${fromDate}): ${inWindow.length}`);
for (const { note, parsed } of inWindow) {
  console.log(
    `    work_date=${parsed.workDate ?? note.created_at.slice(0, 10)}  duration=${parsed.durationText}  body=${JSON.stringify(note.body)}`,
  );
}
