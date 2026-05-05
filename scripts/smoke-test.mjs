// One-off smoke test: spawn the MCP server over stdio, do the JSON-RPC handshake,
// list tools, and call list_my_issues. Prints results to stderr/stdout.
// Usage: NODE=/path/to/node20 node scripts/smoke-test.mjs
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Minimal .env loader (we don't depend on dotenv at runtime).
const env = { ...process.env };
try {
  const raw = readFileSync(resolve(repoRoot, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (m[1].startsWith("#")) continue;
    if (line.trimStart().startsWith("#")) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!env[m[1]]) env[m[1]] = val;
  }
} catch (e) {
  console.error(`could not read .env: ${e.message}`);
}

if (!env.GITLAB_TOKEN) {
  console.error("GITLAB_TOKEN not set in env or .env");
  process.exit(2);
}

const serverPath = resolve(repoRoot, "dist/index.js");
const child = spawn(process.argv[2] ?? "node", [serverPath], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(`[server stderr] ${chunk}`);
});
child.on("exit", (code, sig) => {
  console.error(`[server exited] code=${code} signal=${sig}`);
});

// Frame messages as newline-delimited JSON.
let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error(`[non-JSON line] ${line}`);
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else {
      console.error(`[server notification] ${JSON.stringify(msg)}`);
    }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  child.stdin.write(payload + "\n");
  return new Promise((resolveResp, rejectResp) => {
    pending.set(id, (msg) => {
      if (msg.error) rejectResp(new Error(JSON.stringify(msg.error)));
      else resolveResp(msg.result);
    });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rejectResp(new Error(`timeout waiting for ${method}`));
      }
    }, 30_000);
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

try {
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" },
  });
  console.log("=== initialize ===");
  console.log(JSON.stringify(init, null, 2));

  notify("notifications/initialized", {});

  const tools = await send("tools/list", {});
  console.log("\n=== tools/list ===");
  console.log(
    JSON.stringify(
      { count: tools.tools.length, names: tools.tools.map((t) => t.name) },
      null,
      2,
    ),
  );

  // 1. list_my_issues — pick a real (project_id, iid) from the response for follow-up.
  const issuesCall = await send("tools/call", {
    name: "list_my_issues",
    arguments: { limit: 5 },
  });
  console.log("\n=== list_my_issues (limit=5) ===");
  console.log(issuesCall.content[0].text.slice(0, 800));
  const issuesPayload = JSON.parse(issuesCall.content[0].text);
  const firstIssue = issuesPayload.issues?.[0];

  // 2. list_my_merge_requests
  const mrsCall = await send("tools/call", {
    name: "list_my_merge_requests",
    arguments: { limit: 5, state: "all" },
  });
  console.log("\n=== list_my_merge_requests (limit=5, state=all) ===");
  console.log(mrsCall.content[0].text.slice(0, 1500));
  const mrsPayload = JSON.parse(mrsCall.content[0].text);
  const firstMr = mrsPayload.merge_requests?.[0];

  // 3. get_issue using the first issue from step 1
  if (firstIssue) {
    const issueCall = await send("tools/call", {
      name: "get_issue",
      arguments: {
        project_id: firstIssue.project_id,
        issue_iid: firstIssue.issue_iid,
      },
    });
    console.log(
      `\n=== get_issue (project=${firstIssue.project_id}, iid=${firstIssue.issue_iid}) ===`,
    );
    console.log(issueCall.content[0].text.slice(0, 1500));
  } else {
    console.log("\n=== get_issue: skipped (no issues to target) ===");
  }

  // 4. get_merge_request — first try a real MR; otherwise probe with a known invalid id to verify error path.
  if (firstMr) {
    const mrCall = await send("tools/call", {
      name: "get_merge_request",
      arguments: {
        project_id: firstMr.project_id,
        mr_iid: firstMr.mr_iid,
        include_diffs: false,
      },
    });
    console.log(
      `\n=== get_merge_request (project=${firstMr.project_id}, iid=${firstMr.mr_iid}, no diffs) ===`,
    );
    console.log(mrCall.content[0].text.slice(0, 1500));
  } else {
    console.log("\n=== get_merge_request: probing 404 path (no real MR to target) ===");
    const mrCall = await send("tools/call", {
      name: "get_merge_request",
      arguments: { project_id: 236, mr_iid: 999999 },
    });
    console.log(JSON.stringify(mrCall, null, 2).slice(0, 800));
  }

  // 5. search_projects — caller can override the query via SMOKE_QUERY env.
  const smokeQuery = env.SMOKE_QUERY ?? "test";
  const searchCall = await send("tools/call", {
    name: "search_projects",
    arguments: { query: smokeQuery, limit: 5 },
  });
  console.log(`\n=== search_projects (query=${smokeQuery}, limit=5) ===`);
  console.log(searchCall.content[0].text.slice(0, 1800));
  const searchPayload = JSON.parse(searchCall.content[0].text);
  const firstProject = searchPayload.projects?.[0];

  // 6. list_project_pipelines — pick a project. Prefer the MR's project if present
  //    (likely to have CI activity), otherwise fall back to search result, otherwise 236.
  const pipelineProjectId =
    firstMr?.project_id ?? firstProject?.id ?? 236;
  const pipelinesCall = await send("tools/call", {
    name: "list_project_pipelines",
    arguments: { project_id: pipelineProjectId, limit: 5 },
  });
  console.log(
    `\n=== list_project_pipelines (project=${pipelineProjectId}, limit=5) ===`,
  );
  console.log(pipelinesCall.content[0].text.slice(0, 1800));

  // 7. list_project_pipelines via the slug form to confirm path-based project_id works.
  if (firstProject?.path_with_namespace) {
    const slugCall = await send("tools/call", {
      name: "list_project_pipelines",
      arguments: { project_id: firstProject.path_with_namespace, limit: 2 },
    });
    console.log(
      `\n=== list_project_pipelines via slug ('${firstProject.path_with_namespace}', limit=2) ===`,
    );
    console.log(slugCall.content[0].text.slice(0, 1200));
  }

  // 8. get_time on the same MR/issue we already have. Read-only.
  if (firstMr) {
    const getTimeMr = await send("tools/call", {
      name: "get_time",
      arguments: {
        target_type: "merge_request",
        project_id: firstMr.project_id,
        iid: firstMr.mr_iid,
      },
    });
    console.log(
      `\n=== get_time MR (project=${firstMr.project_id}, iid=${firstMr.mr_iid}) ===`,
    );
    console.log(getTimeMr.content[0].text.slice(0, 600));
  }
  if (firstIssue) {
    const getTimeIssue = await send("tools/call", {
      name: "get_time",
      arguments: {
        target_type: "issue",
        project_id: firstIssue.project_id,
        iid: firstIssue.issue_iid,
      },
    });
    console.log(
      `\n=== get_time issue (project=${firstIssue.project_id}, iid=${firstIssue.issue_iid}) ===`,
    );
    console.log(getTimeIssue.content[0].text.slice(0, 600));
  }

  // 9. report_time. Use a 14-day window so we surface entries the user knows are present.
  const today = new Date().toISOString().slice(0, 10);
  const fourteenAgo = new Date();
  fourteenAgo.setUTCDate(fourteenAgo.getUTCDate() - 14);
  const fromIso = fourteenAgo.toISOString().slice(0, 10);
  const reportCall = await send("tools/call", {
    name: "report_time",
    arguments: { from: fromIso, to: today },
  });
  console.log(`\n=== report_time (from=${fromIso}, to=${today}) ===`);
  const reportText = reportCall.content[0].text;
  console.log(reportText.slice(0, 2500));
  // Reconcile the totals as a sanity check.
  try {
    const r = JSON.parse(reportText);
    const sum = (r.days ?? []).reduce((a, d) => a + d.total_seconds, 0);
    console.log(
      `[totals reconcile] days_sum=${sum} grand_total=${r.grand_total_seconds} match=${sum === r.grand_total_seconds}`,
    );
  } catch {}

  // 10. log_time and delete_time WITH WRITES DISABLED — confirm gated error path.
  //     We verify by env: this server process inherited from the parent. Smoke test
  //     spawn does not set GITLAB_ENABLE_WRITES, so writes should be off.
  const logCall = await send("tools/call", {
    name: "log_time",
    arguments: {
      target_type: "issue",
      project_id: 236,
      iid: 999999,
      duration: "1m",
    },
  });
  console.log("\n=== log_time with writes disabled (expect isError) ===");
  console.log(JSON.stringify(logCall, null, 2).slice(0, 600));

  const delCall = await send("tools/call", {
    name: "delete_time",
    arguments: {
      target_type: "issue",
      project_id: 236,
      iid: 999999,
      duration: "1m",
    },
  });
  console.log("\n=== delete_time with writes disabled (expect isError) ===");
  console.log(JSON.stringify(delCall, null, 2).slice(0, 600));
} catch (err) {
  console.error("smoke test failed:", err.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
