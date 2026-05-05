#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { GitlabClient, GitlabError } from "./gitlab-client.js";
import {
  getIssueTool,
  makeGetIssueHandler,
  type GetIssueInput,
} from "./tools/get-issue.js";
import {
  getMergeRequestTool,
  makeGetMergeRequestHandler,
  type GetMergeRequestInput,
} from "./tools/get-merge-request.js";
import {
  listMyIssuesTool,
  makeListMyIssuesHandler,
  type ListMyIssuesInput,
} from "./tools/list-my-issues.js";
import {
  listMyMergeRequestsTool,
  makeListMyMergeRequestsHandler,
  type ListMyMergeRequestsInput,
} from "./tools/list-my-merge-requests.js";
import {
  listProjectPipelinesTool,
  makeListProjectPipelinesHandler,
  type ListProjectPipelinesInput,
} from "./tools/list-project-pipelines.js";
import {
  searchProjectsTool,
  makeSearchProjectsHandler,
  type SearchProjectsInput,
} from "./tools/search-projects.js";
import {
  logTimeTool,
  makeLogTimeHandler,
  type LogTimeInput,
} from "./tools/log-time.js";
import {
  getTimeTool,
  makeGetTimeHandler,
  type GetTimeInput,
} from "./tools/get-time.js";
import {
  deleteTimeTool,
  makeDeleteTimeHandler,
  type DeleteTimeInput,
} from "./tools/delete-time.js";
import {
  reportTimeTool,
  makeReportTimeHandler,
  type ReportTimeInput,
} from "./tools/report-time.js";
import {
  commentOnIssueTool,
  makeCommentOnIssueHandler,
  type CommentOnIssueInput,
} from "./tools/comment-on-issue.js";
import {
  commentOnMrTool,
  makeCommentOnMrHandler,
  type CommentOnMrInput,
} from "./tools/comment-on-mr.js";
import {
  createIssueTool,
  makeCreateIssueHandler,
  type CreateIssueInput,
} from "./tools/create-issue.js";
import {
  updateIssueTool,
  makeUpdateIssueHandler,
  type UpdateIssueInput,
} from "./tools/update-issue.js";
import {
  updateMergeRequestTool,
  makeUpdateMergeRequestHandler,
  type UpdateMergeRequestInput,
} from "./tools/update-merge-request.js";
import {
  getFileContentTool,
  makeGetFileContentHandler,
  type GetFileContentInput,
} from "./tools/get-file-content.js";
import {
  listRepositoryTreeTool,
  makeListRepositoryTreeHandler,
  type ListRepositoryTreeInput,
} from "./tools/list-repository-tree.js";
import {
  getMrDiffTool,
  makeGetMrDiffHandler,
  type GetMrDiffInput,
} from "./tools/get-mr-diff.js";
import {
  searchCodeTool,
  makeSearchCodeHandler,
  type SearchCodeInput,
} from "./tools/search-code.js";
import {
  getPipelineJobsTool,
  makeGetPipelineJobsHandler,
  type GetPipelineJobsInput,
} from "./tools/get-pipeline-jobs.js";
import {
  getJobLogTool,
  makeGetJobLogHandler,
  type GetJobLogInput,
} from "./tools/get-job-log.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new GitlabClient(config.gitlabUrl, config.gitlabToken);

  // Resolve the current user once so list_my_merge_requests can filter by reviewer_username.
  const me = await client.getCurrentUser();

  const server = new McpServer({
    name: "gitlab-mcp-server",
    version: "0.7.0",
  });

  const listMyIssues = makeListMyIssuesHandler(
    client,
    config.actionableStatuses,
  );
  server.registerTool(
    listMyIssuesTool.name,
    listMyIssuesTool.config,
    async (args) => wrap(() => listMyIssues(args as ListMyIssuesInput)),
  );

  const listMyMergeRequests = makeListMyMergeRequestsHandler(client, me.username);
  server.registerTool(
    listMyMergeRequestsTool.name,
    listMyMergeRequestsTool.config,
    async (args) =>
      wrap(() => listMyMergeRequests(args as ListMyMergeRequestsInput)),
  );

  const getIssue = makeGetIssueHandler(client);
  server.registerTool(
    getIssueTool.name,
    getIssueTool.config,
    async (args) => wrap(() => getIssue(args as GetIssueInput)),
  );

  const getMergeRequest = makeGetMergeRequestHandler(client);
  server.registerTool(
    getMergeRequestTool.name,
    getMergeRequestTool.config,
    async (args) => wrap(() => getMergeRequest(args as GetMergeRequestInput)),
  );

  const listProjectPipelines = makeListProjectPipelinesHandler(client);
  server.registerTool(
    listProjectPipelinesTool.name,
    listProjectPipelinesTool.config,
    async (args) =>
      wrap(() => listProjectPipelines(args as ListProjectPipelinesInput)),
  );

  const searchProjects = makeSearchProjectsHandler(client);
  server.registerTool(
    searchProjectsTool.name,
    searchProjectsTool.config,
    async (args) => wrap(() => searchProjects(args as SearchProjectsInput)),
  );

  const logTime = makeLogTimeHandler(client, config.enableWrites);
  server.registerTool(
    logTimeTool.name,
    logTimeTool.config,
    async (args) => wrap(() => logTime(args as LogTimeInput)),
  );

  const getTime = makeGetTimeHandler(client);
  server.registerTool(
    getTimeTool.name,
    getTimeTool.config,
    async (args) => wrap(() => getTime(args as GetTimeInput)),
  );

  const deleteTime = makeDeleteTimeHandler(client, config.enableWrites);
  server.registerTool(
    deleteTimeTool.name,
    deleteTimeTool.config,
    async (args) => wrap(() => deleteTime(args as DeleteTimeInput)),
  );

  const reportTime = makeReportTimeHandler(client, me.username);
  server.registerTool(
    reportTimeTool.name,
    reportTimeTool.config,
    async (args) => wrap(() => reportTime(args as ReportTimeInput)),
  );

  const commentOnIssue = makeCommentOnIssueHandler(client, config.enableWrites);
  server.registerTool(
    commentOnIssueTool.name,
    commentOnIssueTool.config,
    async (args) => wrap(() => commentOnIssue(args as CommentOnIssueInput)),
  );

  const commentOnMr = makeCommentOnMrHandler(client, config.enableWrites);
  server.registerTool(
    commentOnMrTool.name,
    commentOnMrTool.config,
    async (args) => wrap(() => commentOnMr(args as CommentOnMrInput)),
  );

  const createIssue = makeCreateIssueHandler(client, config.enableWrites);
  server.registerTool(
    createIssueTool.name,
    createIssueTool.config,
    async (args) => wrap(() => createIssue(args as CreateIssueInput)),
  );

  const updateIssue = makeUpdateIssueHandler(client, config.enableWrites);
  server.registerTool(
    updateIssueTool.name,
    updateIssueTool.config,
    async (args) => wrap(() => updateIssue(args as UpdateIssueInput)),
  );

  const updateMergeRequest = makeUpdateMergeRequestHandler(
    client,
    config.enableWrites,
  );
  server.registerTool(
    updateMergeRequestTool.name,
    updateMergeRequestTool.config,
    async (args) =>
      wrap(() => updateMergeRequest(args as UpdateMergeRequestInput)),
  );

  const getFileContent = makeGetFileContentHandler(client);
  server.registerTool(
    getFileContentTool.name,
    getFileContentTool.config,
    async (args) => wrap(() => getFileContent(args as GetFileContentInput)),
  );

  const listRepositoryTree = makeListRepositoryTreeHandler(client);
  server.registerTool(
    listRepositoryTreeTool.name,
    listRepositoryTreeTool.config,
    async (args) =>
      wrap(() => listRepositoryTree(args as ListRepositoryTreeInput)),
  );

  const getMrDiff = makeGetMrDiffHandler(client);
  server.registerTool(
    getMrDiffTool.name,
    getMrDiffTool.config,
    async (args) => wrap(() => getMrDiff(args as GetMrDiffInput)),
  );

  const searchCode = makeSearchCodeHandler(client);
  server.registerTool(
    searchCodeTool.name,
    searchCodeTool.config,
    async (args) => wrap(() => searchCode(args as SearchCodeInput)),
  );

  const getPipelineJobs = makeGetPipelineJobsHandler(client);
  server.registerTool(
    getPipelineJobsTool.name,
    getPipelineJobsTool.config,
    async (args) => wrap(() => getPipelineJobs(args as GetPipelineJobsInput)),
  );

  const getJobLog = makeGetJobLogHandler(client);
  server.registerTool(
    getJobLogTool.name,
    getJobLogTool.config,
    async (args) => wrap(() => getJobLog(args as GetJobLogInput)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function wrap<T extends { content: Array<{ type: "text"; text: string }> }>(
  fn: () => Promise<T>,
): Promise<T | { isError: true; content: [{ type: "text"; text: string }] }> {
  try {
    return await fn();
  } catch (err) {
    const message =
      err instanceof GitlabError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}

main().catch((err) => {
  process.stderr.write(
    `[gitlab-mcp-server] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
