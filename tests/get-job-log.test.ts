import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeGetJobLogHandler } from "../src/tools/get-job-log.js";
import { captureStderr, installFetchMock, type QueuedResponse } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

const SAMPLE_JOB = {
  id: 99,
  name: "test:unit",
  stage: "test",
  status: "failed",
  ref: "main",
  created_at: "2026-04-28T08:00:00Z",
  started_at: "2026-04-28T08:01:00Z",
  finished_at: "2026-04-28T08:05:00Z",
  duration: 240,
  web_url: "https://jakota.dev/x/-/jobs/99",
  failure_reason: "script_failure",
};

/** Queue: [job-detail, log-text]. Order matches handler's Promise.all order. */
function queueFor(log: string): QueuedResponse[] {
  return [
    { ok: true, status: 200, body: SAMPLE_JOB },
    { ok: true, status: 200, body: log, contentType: "text/plain" },
  ];
}

describe("get_job_log — request shape & parallel fetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fires both /jobs/:id and /jobs/:id/trace requests (in parallel)", async () => {
    const fetchMock = installFetchMock(queueFor("hello"));
    const handler = makeGetJobLogHandler(newClient());
    await handler({ project_id: 89, job_id: 99 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = (fetchMock.mock.calls as Array<[string, RequestInit]>).map(
      ([u]) => u,
    );
    expect(urls).toContain(`${BASE_URL}/projects/89/jobs/99`);
    expect(urls).toContain(`${BASE_URL}/projects/89/jobs/99/trace`);
  });

  it("URL-encodes a path-style project_id on both calls", async () => {
    const fetchMock = installFetchMock(queueFor("hello"));
    const handler = makeGetJobLogHandler(newClient());
    await handler({ project_id: "jakota/support", job_id: 99 });
    const urls = (fetchMock.mock.calls as Array<[string, RequestInit]>).map(
      ([u]) => u,
    );
    expect(urls).toContain(`${BASE_URL}/projects/jakota%2Fsupport/jobs/99`);
    expect(urls).toContain(
      `${BASE_URL}/projects/jakota%2Fsupport/jobs/99/trace`,
    );
  });
});

describe("get_job_log — ANSI stripping", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("strips ANSI before measuring length and returns the cleaned log", async () => {
    const raw = "\x1b[31;1mERROR\x1b[0m something broke\n";
    installFetchMock(queueFor(raw));
    const handler = makeGetJobLogHandler(newClient());
    const result = await handler({ project_id: 89, job_id: 99 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.log).toBe("ERROR something broke\n");
    expect(json.total_bytes).toBe("ERROR something broke\n".length);
  });

  it("byte counts (total_bytes) are POST-strip, not pre-strip", async () => {
    const raw = "\x1b[32mok\x1b[0m\n"; // many bytes raw, "ok\n" = 3 cleaned
    installFetchMock(queueFor(raw));
    const handler = makeGetJobLogHandler(newClient());
    const result = await handler({ project_id: 89, job_id: 99 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.total_bytes).toBe(3);
    expect(json.truncated).toBe(false);
  });
});

describe("get_job_log — tail/head truncation", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("tail=true (default): returns the LAST max_bytes prefixed with the marker", async () => {
    const raw = "0123456789".repeat(100); // 1000 bytes
    installFetchMock(queueFor(raw));
    const handler = makeGetJobLogHandler(newClient());
    const result = await handler({
      project_id: 89,
      job_id: 99,
      max_bytes: 100,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.tailed).toBe(true);
    expect(json.truncated).toBe(true);
    expect(json.total_bytes).toBe(1000);
    expect(json.returned_bytes).toBe(100);
    // last 100 chars of raw are the last "0123456789" repeated 10 times
    const expectedTail = raw.slice(-100);
    expect(json.log).toBe(
      `[... showing last 100 bytes of 1000 total ...]\n${expectedTail}`,
    );
  });

  it("tail=false: returns the FIRST max_bytes appended with the marker", async () => {
    const raw = "0123456789".repeat(100); // 1000 bytes
    installFetchMock(queueFor(raw));
    const handler = makeGetJobLogHandler(newClient());
    const result = await handler({
      project_id: 89,
      job_id: 99,
      max_bytes: 100,
      tail: false,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.tailed).toBe(false);
    expect(json.truncated).toBe(true);
    expect(json.total_bytes).toBe(1000);
    expect(json.returned_bytes).toBe(100);
    const expectedHead = raw.slice(0, 100);
    expect(json.log).toBe(
      `${expectedHead}\n[... showing first 100 bytes of 1000 total ...]`,
    );
  });

  it("does not truncate when log fits — no marker, no [TRUNCATE] log", async () => {
    installFetchMock(queueFor("short log\n"));
    const handler = makeGetJobLogHandler(newClient());
    const result = await handler({ project_id: 89, job_id: 99 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.truncated).toBe(false);
    expect(json.log).toBe("short log\n");
    expect(json.log).not.toMatch(/showing last|showing first/);
    expect(stderr.text()).not.toContain("[TRUNCATE]");
  });

  it("emits [TRUNCATE] to stderr including job_id and tailed flag", async () => {
    installFetchMock(queueFor("a".repeat(500)));
    const handler = makeGetJobLogHandler(newClient());
    await handler({ project_id: 89, job_id: 99, max_bytes: 100 });
    expect(stderr.text()).toMatch(
      /^\[TRUNCATE\] tool=get_job_log original_bytes=500 returned_bytes=100 limit=100 job_id=99 tailed=true\n/,
    );
  });

  it("truncation budget is computed AFTER ANSI stripping", async () => {
    // 50 bytes of color codes + "y".repeat(200) = 200 bytes after strip.
    // max_bytes=100 means we SHOULD truncate (200>100), but only because
    // we counted post-strip. If we'd counted pre-strip, we might've thought
    // it fit.
    const raw = "\x1b[31m".repeat(10) + "y".repeat(200) + "\x1b[0m".repeat(10);
    installFetchMock(queueFor(raw));
    const handler = makeGetJobLogHandler(newClient());
    const result = await handler({
      project_id: 89,
      job_id: 99,
      max_bytes: 100,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.total_bytes).toBe(200); // post-strip
    expect(json.truncated).toBe(true);
    expect(json.returned_bytes).toBe(100);
    // The returned tail should be "y" * 100, not include any escapes
    expect(json.log.endsWith("y".repeat(100))).toBe(true);
    expect(json.log).not.toMatch(/\x1b/);
  });
});

describe("get_job_log — output shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the spec'd envelope: { job_id, status, log, truncated, total_bytes, returned_bytes, tailed }", async () => {
    installFetchMock(queueFor("hello\n"));
    const handler = makeGetJobLogHandler(newClient());
    const result = await handler({ project_id: 89, job_id: 99 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(Object.keys(json).sort()).toEqual(
      [
        "job_id",
        "status",
        "log",
        "truncated",
        "total_bytes",
        "returned_bytes",
        "tailed",
      ].sort(),
    );
    expect(json.job_id).toBe(99);
    expect(json.status).toBe("failed");
  });
});
