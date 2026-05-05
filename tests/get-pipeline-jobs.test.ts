import { afterEach, describe, expect, it, vi } from "vitest";
import { GitlabClient } from "../src/gitlab-client.js";
import { makeGetPipelineJobsHandler } from "../src/tools/get-pipeline-jobs.js";
import { installFetchMock } from "./helpers.js";

const BASE_URL = "https://jakota.dev/api/v4";
const TOKEN = "glpat-test";

function newClient() {
  return new GitlabClient(BASE_URL, TOKEN);
}

function mkJob(overrides: Partial<Record<string, unknown>> & {
  id: number;
  name: string;
  stage: string;
  status: string;
}) {
  return {
    ref: "main",
    created_at: "2026-04-28T08:00:00Z",
    started_at: "2026-04-28T08:01:00Z",
    finished_at: "2026-04-28T08:05:00Z",
    duration: 240,
    web_url: `https://jakota.dev/x/-/jobs/${overrides.id}`,
    failure_reason: null,
    // GitLab adds extra fields we should drop:
    pipeline: { id: 999 },
    runner: { id: 1, description: "shared" },
    coverage: null,
    ...overrides,
  };
}

describe("get_pipeline_jobs — request shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hits /projects/:id/pipelines/:pid/jobs without scope when omitted", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeGetPipelineJobsHandler(newClient());
    await handler({ project_id: 89, pipeline_id: 12345 });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/89/pipelines/12345/jobs?per_page=100`,
    );
    expect(url).not.toMatch(/scope/);
  });

  it("forwards scope as scope[]= (encoded brackets) when provided", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeGetPipelineJobsHandler(newClient());
    await handler({ project_id: 89, pipeline_id: 12345, scope: "failed" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/projects/89/pipelines/12345/jobs?per_page=100&scope%5B%5D=failed`,
    );
  });

  it("URL-encodes a path-style project_id", async () => {
    const fetchMock = installFetchMock([
      { ok: true, status: 200, body: [] },
    ]);
    const handler = makeGetPipelineJobsHandler(newClient());
    await handler({ project_id: "jakota/group/repo", pipeline_id: 12345 });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(
      url.startsWith(
        `${BASE_URL}/projects/jakota%2Fgroup%2Frepo/pipelines/12345/jobs?`,
      ),
    ).toBe(true);
  });
});

describe("get_pipeline_jobs — output shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sorts jobs by stage, then by name (alphabetical, stable)", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: [
          mkJob({ id: 4, name: "deploy:prod", stage: "deploy", status: "manual" }),
          mkJob({ id: 1, name: "test:unit", stage: "test", status: "success" }),
          mkJob({ id: 2, name: "test:lint", stage: "test", status: "success" }),
          mkJob({ id: 3, name: "build", stage: "build", status: "success" }),
        ],
      },
    ]);
    const handler = makeGetPipelineJobsHandler(newClient());
    const result = await handler({ project_id: 89, pipeline_id: 12345 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.jobs.map((j: { name: string; stage: string }) => `${j.stage}:${j.name}`))
      .toEqual([
        "build:build",
        "deploy:deploy:prod",
        "test:test:lint",
        "test:test:unit",
      ]);
  });

  it("returns the spec'd 11 fields per job and drops everything else", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: [
          mkJob({
            id: 1,
            name: "test",
            stage: "test",
            status: "failed",
            failure_reason: "script_failure",
          }),
        ],
      },
    ]);
    const handler = makeGetPipelineJobsHandler(newClient());
    const result = await handler({ project_id: 89, pipeline_id: 12345 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(Object.keys(json.jobs[0]).sort()).toEqual(
      [
        "id",
        "name",
        "stage",
        "status",
        "ref",
        "created_at",
        "started_at",
        "finished_at",
        "duration",
        "web_url",
        "failure_reason",
      ].sort(),
    );
    expect(json.jobs[0]).not.toHaveProperty("pipeline");
    expect(json.jobs[0]).not.toHaveProperty("runner");
    expect(json.jobs[0]).not.toHaveProperty("coverage");
  });

  it("defaults failure_reason to null when GitLab omits it", async () => {
    installFetchMock([
      {
        ok: true,
        status: 200,
        body: [
          {
            id: 1,
            name: "test",
            stage: "test",
            status: "success",
            ref: "main",
            created_at: "2026-04-28T08:00:00Z",
            started_at: "2026-04-28T08:01:00Z",
            finished_at: "2026-04-28T08:05:00Z",
            duration: 240,
            web_url: "https://jakota.dev/x/-/jobs/1",
            // failure_reason absent
          },
        ],
      },
    ]);
    const handler = makeGetPipelineJobsHandler(newClient());
    const result = await handler({ project_id: 89, pipeline_id: 12345 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.jobs[0].failure_reason).toBeNull();
  });

  it("returns count=0 and empty list when GitLab returns []", async () => {
    installFetchMock([{ ok: true, status: 200, body: [] }]);
    const handler = makeGetPipelineJobsHandler(newClient());
    const result = await handler({ project_id: 89, pipeline_id: 12345 });
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json).toEqual({ count: 0, jobs: [] });
  });
});
