import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeGetMrDiffHandler } from "../src/tools/get-mr-diff.js";
import { captureStderr, installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

function mkChange(opts: {
  old_path?: string;
  new_path: string;
  diff: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
}) {
  return {
    a_mode: "100644",
    b_mode: "100644",
    old_path: opts.old_path ?? opts.new_path,
    new_path: opts.new_path,
    new_file: opts.new_file ?? false,
    deleted_file: opts.deleted_file ?? false,
    renamed_file: opts.renamed_file ?? false,
    diff: opts.diff,
  };
}

/** Build a `GET /merge_requests/:iid/changes` mock response shape. */
function changesResponse(changes: ReturnType<typeof mkChange>[]) {
  return {
    ok: true as const,
    status: 200,
    body: {
      iid: 3137,
      project_id: 89,
      title: "test",
      changes_count: String(changes.length),
      changes,
    },
  };
}

describe("get_mr_diff — request shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("GETs /merge_requests/:iid/changes (NOT /diffs, NOT /merge_requests/:iid)", async () => {
    const fetchMock = installFetchMock([
      changesResponse([mkChange({ new_path: "a.ts", diff: "+1\n-2\n" })]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    await handler({ project_id: 89, mr_iid: 3137 });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/projects/89/merge_requests/3137/changes`);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("URL-encodes a path-style project_id", async () => {
    const fetchMock = installFetchMock([changesResponse([])]);
    const handler = makeGetMrDiffHandler(newClient());
    await handler({ project_id: "jakota/group/repo", mr_iid: 3137 });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/jakota%2Fgroup%2Frepo/merge_requests/3137/changes`,
    );
  });
});

describe("get_mr_diff — output shape", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("returns the spec'd 6 per-file fields and drops everything else", async () => {
    installFetchMock([
      changesResponse([mkChange({ new_path: "a.ts", diff: "+x\n" })]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({ project_id: 89, mr_iid: 3137 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files[0]).toEqual({
      old_path: "a.ts",
      new_path: "a.ts",
      new_file: false,
      deleted_file: false,
      renamed_file: false,
      diff: "+x\n",
    });
    expect(json.files[0]).not.toHaveProperty("a_mode");
    expect(json.files[0]).not.toHaveProperty("b_mode");
  });

  it("does not include MR metadata (no description / labels / state)", async () => {
    installFetchMock([
      changesResponse([mkChange({ new_path: "a.ts", diff: "+x\n" })]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({ project_id: 89, mr_iid: 3137 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(Object.keys(json).sort()).toEqual(
      [
        "files",
        "files_omitted",
        "mr_iid",
        "note",
        "project_id",
        "returned_diff_bytes",
        "total_diff_bytes",
        "truncated",
      ].sort(),
    );
  });

  it("returns truncated=false, files_omitted=0, note=null when nothing is dropped", async () => {
    installFetchMock([
      changesResponse([
        mkChange({ new_path: "a.ts", diff: "+1\n" }),
        mkChange({ new_path: "b.ts", diff: "+2\n" }),
      ]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({ project_id: 89, mr_iid: 3137 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.truncated).toBe(false);
    expect(json.files_omitted).toBe(0);
    expect(json.note).toBeNull();
    expect(json.files).toHaveLength(2);
    expect(json.total_diff_bytes).toBe(json.returned_diff_bytes);
  });
});

describe("get_mr_diff — file-boundary truncation", () => {
  let stderr: ReturnType<typeof captureStderr>;
  beforeEach(() => {
    stderr = captureStderr();
  });
  afterEach(() => {
    stderr.restore();
    vi.unstubAllGlobals();
  });

  it("includes files greedily until adding the next would exceed the cap", async () => {
    // limit=100. file1=40b (cum=40 ✓). file2=40b (cum=80 ✓). file3=40b (cum=120 ✗ stop).
    const f = (n: number) => mkChange({ new_path: `${n}.ts`, diff: "x".repeat(40) });
    installFetchMock([changesResponse([f(1), f(2), f(3), f(4)])]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({
      project_id: 89,
      mr_iid: 3137,
      max_total_bytes: 100,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files).toHaveLength(2);
    expect(json.files.map((f: { new_path: string }) => f.new_path)).toEqual([
      "1.ts",
      "2.ts",
    ]);
    expect(json.truncated).toBe(true);
    expect(json.files_omitted).toBe(2);
    expect(json.returned_diff_bytes).toBe(80);
    expect(json.total_diff_bytes).toBe(160);
  });

  it("never truncates inside a file's diff string — diffs are returned byte-exact", async () => {
    // A 200-byte file that fits and a 200-byte file that does not. Verify the
    // 1st file's diff is exactly 200 bytes (not 100, not 199, not 201).
    installFetchMock([
      changesResponse([
        mkChange({ new_path: "fits.ts", diff: "y".repeat(200) }),
        mkChange({ new_path: "doesnt.ts", diff: "z".repeat(200) }),
      ]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({
      project_id: 89,
      mr_iid: 3137,
      max_total_bytes: 250, // first file fits; second pushes over (200+200=400 > 250)
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files).toHaveLength(1);
    expect(json.files[0].diff).toBe("y".repeat(200));
    expect(json.files[0].diff).toHaveLength(200);
    expect(json.truncated).toBe(true);
    expect(json.files_omitted).toBe(1);
  });

  it("when a single file's diff exceeds max_total_bytes, returns ZERO files (per spec)", async () => {
    installFetchMock([
      changesResponse([
        mkChange({ new_path: "huge.ts", diff: "x".repeat(500) }),
        mkChange({ new_path: "small.ts", diff: "y".repeat(20) }),
      ]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({
      project_id: 89,
      mr_iid: 3137,
      max_total_bytes: 100,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files).toEqual([]);
    expect(json.truncated).toBe(true);
    expect(json.files_omitted).toBe(2);
    expect(json.total_diff_bytes).toBe(520);
    expect(json.returned_diff_bytes).toBe(0);
    expect(json.note).toMatch(
      /\[\.\.\. 2 more files not shown, total diff is 520 bytes \.\.\.\]/,
    );
  });

  it("does not 'pack' small files after a skip — once truncated, all subsequent files are omitted", async () => {
    // Spec: stop iteration on first overflow, even if a later small file
    // would fit. Keeps output a contiguous prefix of the change list.
    installFetchMock([
      changesResponse([
        mkChange({ new_path: "a.ts", diff: "x".repeat(60) }), // cum=60 ✓
        mkChange({ new_path: "huge.ts", diff: "y".repeat(200) }), // cum 260 ✗ stop
        mkChange({ new_path: "small.ts", diff: "z".repeat(5) }), // would fit, but skip
      ]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({
      project_id: 89,
      mr_iid: 3137,
      max_total_bytes: 100,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files.map((f: { new_path: string }) => f.new_path)).toEqual([
      "a.ts",
    ]);
    expect(json.files_omitted).toBe(2);
  });

  it("note text uses singular 'file' for files_omitted=1, plural for >1", async () => {
    installFetchMock([
      changesResponse([
        mkChange({ new_path: "a.ts", diff: "x".repeat(80) }),
        mkChange({ new_path: "b.ts", diff: "y".repeat(80) }),
      ]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({
      project_id: 89,
      mr_iid: 3137,
      max_total_bytes: 100,
    });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files_omitted).toBe(1);
    expect(json.note).toMatch(
      /\[\.\.\. 1 more file not shown, total diff is 160 bytes \.\.\.\]/,
    );
  });

  it("emits [TRUNCATE] to stderr when files are dropped", async () => {
    installFetchMock([
      changesResponse([
        mkChange({ new_path: "a.ts", diff: "x".repeat(60) }),
        mkChange({ new_path: "b.ts", diff: "y".repeat(60) }),
      ]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    await handler({
      project_id: 89,
      mr_iid: 3137,
      max_total_bytes: 100,
    });
    expect(stderr.text()).toMatch(
      /^\[TRUNCATE\] tool=get_mr_diff original_bytes=120 returned_bytes=60 limit=100 mr_iid=3137 files_returned=1 files_omitted=1\n/,
    );
  });

  it("does NOT emit [TRUNCATE] when nothing is dropped", async () => {
    installFetchMock([
      changesResponse([mkChange({ new_path: "a.ts", diff: "+x\n" })]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    await handler({ project_id: 89, mr_iid: 3137 });
    expect(stderr.text()).not.toContain("[TRUNCATE]");
  });

  it("a file with an empty diff (e.g. mode-only change) is included for free", async () => {
    installFetchMock([
      changesResponse([
        mkChange({ new_path: "modeonly.ts", diff: "" }),
        mkChange({ new_path: "real.ts", diff: "+x\n" }),
      ]),
    ]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({ project_id: 89, mr_iid: 3137 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files).toHaveLength(2);
    expect(json.truncated).toBe(false);
    expect(json.total_diff_bytes).toBe(3); // "+x\n" is 3 bytes
  });

  it("MR with zero changes returns an empty list, not an error", async () => {
    installFetchMock([changesResponse([])]);
    const handler = makeGetMrDiffHandler(newClient());
    const result = await handler({ project_id: 89, mr_iid: 3137 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.files).toEqual([]);
    expect(json.truncated).toBe(false);
    expect(json.total_diff_bytes).toBe(0);
    expect(json.note).toBeNull();
  });
});
