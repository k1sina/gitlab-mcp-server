import { urlEncodePath } from "./util/url.js";

export class GitlabError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "GitlabError";
  }
}

export interface GitlabUser {
  id: number;
  username: string;
  name: string;
  web_url: string;
}

export interface GitlabMilestone {
  id: number;
  title: string;
  due_date: string | null;
}

export interface GitlabIssueRef {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  state: "opened" | "closed";
  web_url: string;
  labels: string[];
  assignees: GitlabUser[];
  author: GitlabUser;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  milestone: GitlabMilestone | null;
  references?: { short: string; relative: string; full: string };
}

export interface GitlabWorkItemStatus {
  id: string;
  name: string;
  iconName: string;
  color: string;
}

export interface GitlabWorkItemSummary {
  iid: string;
  title: string;
  type: string;
  web_url: string;
}

export interface GitlabWorkItemParentResult {
  child: GitlabWorkItemSummary;
  parent: GitlabWorkItemSummary | null;
}

export interface GitlabIssueDetail extends GitlabIssueRef {
  description: string | null;
  closed_at: string | null;
  closed_by: GitlabUser | null;
  user_notes_count: number;
}

export interface GitlabMergeRequestRef {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  state: "opened" | "closed" | "merged" | "locked";
  web_url: string;
  labels: string[];
  source_branch: string;
  target_branch: string;
  draft: boolean;
  work_in_progress?: boolean;
  merge_status: string;
  detailed_merge_status?: string;
  has_conflicts?: boolean;
  assignees: GitlabUser[];
  reviewers: GitlabUser[];
  author: GitlabUser;
  milestone: GitlabMilestone | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

export interface GitlabMergeRequestDetail extends GitlabMergeRequestRef {
  description: string | null;
  user_notes_count: number;
  changes_count?: string | null;
  diff_refs?: { base_sha: string; head_sha: string; start_sha: string } | null;
}

export interface GitlabMergeRequestChange {
  old_path: string;
  new_path: string;
  a_mode: string;
  b_mode: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

export interface GitlabMergeRequestChanges {
  changes: GitlabMergeRequestChange[];
  changes_count?: string | null;
  overflow?: boolean;
}

export type PipelineStatus =
  | "created"
  | "waiting_for_resource"
  | "preparing"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "skipped"
  | "manual"
  | "scheduled";

export interface GitlabTreeEntry {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
  mode: string;
}

export interface GitlabBlobMatch {
  project_id: number;
  path: string;
  ref: string;
  startline: number;
  data: string;
  basename?: string;
  filename?: string;
  id?: string | null;
}

export type PipelineJobScope =
  | "created"
  | "pending"
  | "running"
  | "failed"
  | "success"
  | "canceled"
  | "skipped"
  | "manual";

export interface GitlabPipelineJob {
  id: number;
  name: string;
  stage: string;
  status: PipelineStatus;
  ref: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration: number | null;
  web_url: string;
  failure_reason?: string | null;
}

export interface GitlabPipelineRef {
  id: number;
  iid?: number;
  project_id: number;
  status: PipelineStatus;
  source: string;
  ref: string;
  sha: string;
  web_url: string;
  name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitlabProjectRef {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string | null;
  web_url: string;
  visibility: "private" | "internal" | "public";
  archived: boolean;
  last_activity_at: string;
  star_count: number;
  forks_count: number;
}

export interface GitlabNote {
  id: number;
  body: string;
  author: GitlabUser;
  created_at: string;
  updated_at: string;
  system: boolean;
  resolvable: boolean;
  resolved?: boolean;
  noteable_iid: number;
  noteable_type: string;
}

export type IssueState = "opened" | "closed" | "all";
export type MergeRequestState = "opened" | "closed" | "merged" | "all";
export type ProjectId = number | string;
export type TimeTrackingTarget = "issue" | "merge_request";

export interface GitlabTimeStats {
  time_estimate: number;
  total_time_spent: number;
  human_time_estimate: string | null;
  human_total_time_spent: string | null;
}

export interface ListMyIssuesOptions {
  state?: IssueState;
  perPage?: number;
}

export interface ListMergeRequestsOptions {
  state?: MergeRequestState;
  perPage?: number;
}

export interface CreateIssuePayload {
  title: string;
  description?: string;
  labels?: string;
  assignee_ids?: number[];
  milestone_id?: number;
  confidential?: boolean;
}

export interface UpdateIssuePayload {
  title?: string;
  description?: string;
  labels?: string;
  add_labels?: string;
  remove_labels?: string;
  assignee_ids?: number[];
  milestone_id?: number;
  state_event?: "close" | "reopen";
}

export interface UpdateMergeRequestPayload {
  title?: string;
  description?: string;
  labels?: string;
  add_labels?: string;
  remove_labels?: string;
  assignee_ids?: number[];
  reviewer_ids?: number[];
  milestone_id?: number;
  state_event?: "close" | "reopen";
  draft?: boolean;
}

/**
 * Projects per work-item-status GraphQL query. GitLab's max complexity is 250
 * and each project fragment costs ~61 (measured: 5 projects = 305).
 */
const STATUS_PROJECTS_PER_QUERY = 3;

export class GitlabClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async getCurrentUser(): Promise<GitlabUser> {
    return this.request<GitlabUser>("/user");
  }

  async listMyIssues(opts: ListMyIssuesOptions = {}): Promise<GitlabIssueRef[]> {
    const params = new URLSearchParams({
      scope: "assigned_to_me",
      per_page: String(opts.perPage ?? 50),
    });
    if (opts.state && opts.state !== "all") {
      params.set("state", opts.state);
    }
    return this.request<GitlabIssueRef[]>(`/issues?${params.toString()}`);
  }

  async listIssuesForReport(
    scope: "assigned_to_me" | "created_by_me",
    updatedAfter: string,
    perPage = 100,
  ): Promise<GitlabIssueRef[]> {
    const params = new URLSearchParams({
      scope,
      state: "all",
      updated_after: updatedAfter,
      per_page: String(perPage),
      order_by: "updated_at",
      sort: "desc",
    });
    return this.request<GitlabIssueRef[]>(`/issues?${params.toString()}`);
  }

  async listMergeRequestsForReport(
    scope: "assigned_to_me" | "created_by_me",
    updatedAfter: string,
    perPage = 100,
  ): Promise<GitlabMergeRequestRef[]> {
    const params = new URLSearchParams({
      scope,
      state: "all",
      updated_after: updatedAfter,
      per_page: String(perPage),
      order_by: "updated_at",
      sort: "desc",
    });
    return this.request<GitlabMergeRequestRef[]>(`/merge_requests?${params.toString()}`);
  }

  async listMergeRequestsAssignedToMe(
    opts: ListMergeRequestsOptions = {},
  ): Promise<GitlabMergeRequestRef[]> {
    const params = new URLSearchParams({
      scope: "assigned_to_me",
      per_page: String(opts.perPage ?? 50),
    });
    if (opts.state && opts.state !== "all") {
      params.set("state", opts.state);
    }
    return this.request<GitlabMergeRequestRef[]>(`/merge_requests?${params.toString()}`);
  }

  async listMergeRequestsForReviewer(
    username: string,
    opts: ListMergeRequestsOptions = {},
  ): Promise<GitlabMergeRequestRef[]> {
    const params = new URLSearchParams({
      scope: "all",
      reviewer_username: username,
      per_page: String(opts.perPage ?? 50),
    });
    if (opts.state && opts.state !== "all") {
      params.set("state", opts.state);
    }
    return this.request<GitlabMergeRequestRef[]>(`/merge_requests?${params.toString()}`);
  }

  async getProject(projectId: ProjectId): Promise<GitlabProjectRef> {
    return this.request<GitlabProjectRef>(
      `/projects/${encodeProjectId(projectId)}`,
    );
  }

  async getIssue(projectId: ProjectId, issueIid: number): Promise<GitlabIssueDetail> {
    return this.request<GitlabIssueDetail>(
      `/projects/${encodeProjectId(projectId)}/issues/${issueIid}`,
    );
  }

  async listIssueNotes(projectId: ProjectId, issueIid: number): Promise<GitlabNote[]> {
    return this.request<GitlabNote[]>(
      `/projects/${encodeProjectId(projectId)}/issues/${issueIid}/notes?sort=asc&per_page=100`,
    );
  }

  async getMergeRequest(
    projectId: ProjectId,
    mrIid: number,
  ): Promise<GitlabMergeRequestDetail> {
    return this.request<GitlabMergeRequestDetail>(
      `/projects/${encodeProjectId(projectId)}/merge_requests/${mrIid}`,
    );
  }

  async getMergeRequestChanges(
    projectId: ProjectId,
    mrIid: number,
  ): Promise<GitlabMergeRequestChanges> {
    return this.request<GitlabMergeRequestChanges>(
      `/projects/${encodeProjectId(projectId)}/merge_requests/${mrIid}/changes`,
    );
  }

  async listMergeRequestNotes(
    projectId: ProjectId,
    mrIid: number,
  ): Promise<GitlabNote[]> {
    return this.request<GitlabNote[]>(
      `/projects/${encodeProjectId(projectId)}/merge_requests/${mrIid}/notes?sort=asc&per_page=100`,
    );
  }

  async listProjectPipelines(
    projectId: ProjectId,
    perPage = 20,
  ): Promise<GitlabPipelineRef[]> {
    const params = new URLSearchParams({
      per_page: String(perPage),
      order_by: "id",
      sort: "desc",
    });
    return this.request<GitlabPipelineRef[]>(
      `/projects/${encodeProjectId(projectId)}/pipelines?${params.toString()}`,
    );
  }

  async getTimeStats(
    target: TimeTrackingTarget,
    projectId: ProjectId,
    iid: number,
  ): Promise<GitlabTimeStats> {
    return this.request<GitlabTimeStats>(
      `/projects/${encodeProjectId(projectId)}/${targetSegment(target)}/${iid}/time_stats`,
    );
  }

  async addSpentTime(
    target: TimeTrackingTarget,
    projectId: ProjectId,
    iid: number,
    duration: string,
    options: { summary?: string; dateTime?: string } = {},
  ): Promise<GitlabTimeStats> {
    const body = new URLSearchParams({ duration });
    if (options.summary) body.set("summary", options.summary);
    if (options.dateTime) body.set("date_time", options.dateTime);
    return this.request<GitlabTimeStats>(
      `/projects/${encodeProjectId(projectId)}/${targetSegment(target)}/${iid}/add_spent_time`,
      {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );
  }

  async createIssueNote(
    projectId: ProjectId,
    iid: number,
    body: string,
  ): Promise<GitlabNote> {
    return this.requestWrite<GitlabNote>(
      `/projects/${encodeProjectId(projectId)}/issues/${iid}/notes`,
      "POST",
      { body },
    );
  }

  async createMergeRequestNote(
    projectId: ProjectId,
    iid: number,
    body: string,
  ): Promise<GitlabNote> {
    return this.requestWrite<GitlabNote>(
      `/projects/${encodeProjectId(projectId)}/merge_requests/${iid}/notes`,
      "POST",
      { body },
    );
  }

  async createIssue(
    projectId: ProjectId,
    payload: CreateIssuePayload,
  ): Promise<GitlabIssueDetail> {
    return this.requestWrite<GitlabIssueDetail>(
      `/projects/${encodeProjectId(projectId)}/issues`,
      "POST",
      payload,
    );
  }

  async updateIssue(
    projectId: ProjectId,
    iid: number,
    payload: UpdateIssuePayload,
  ): Promise<GitlabIssueDetail> {
    return this.requestWrite<GitlabIssueDetail>(
      `/projects/${encodeProjectId(projectId)}/issues/${iid}`,
      "PUT",
      payload,
    );
  }

  async updateMergeRequest(
    projectId: ProjectId,
    iid: number,
    payload: UpdateMergeRequestPayload,
  ): Promise<GitlabMergeRequestDetail> {
    return this.requestWrite<GitlabMergeRequestDetail>(
      `/projects/${encodeProjectId(projectId)}/merge_requests/${iid}`,
      "PUT",
      payload,
    );
  }

  /**
   * Fetch the GitLab Work Item Status widget for a set of (projectPath, iid)
   * pairs. Returns a Map keyed by `${projectPath}#${iid}` whose value is the
   * status (or null when the widget is absent / unset — e.g. tickets in the
   * support project, which doesn't have the field).
   *
   * Batched: one GraphQL request per STATUS_PROJECTS_PER_QUERY projects.
   * GitLab caps query complexity at 250 and each aliased `project { workItems }`
   * fragment costs ~61, so a single query breaks at 5 projects ("Query has
   * complexity of 305"). Batches run sequentially to stay gentle on the API.
   */
  async fetchWorkItemStatuses(
    items: Array<{ projectPath: string; iid: number }>,
  ): Promise<Map<string, GitlabWorkItemStatus | null>> {
    const result = new Map<string, GitlabWorkItemStatus | null>();
    if (items.length === 0) return result;

    // Group iids by project path.
    const byPath = new Map<string, Set<number>>();
    for (const { projectPath, iid } of items) {
      const set = byPath.get(projectPath) ?? new Set<number>();
      set.add(iid);
      byPath.set(projectPath, set);
    }

    const projects = Array.from(byPath);
    for (let i = 0; i < projects.length; i += STATUS_PROJECTS_PER_QUERY) {
      await this.fetchWorkItemStatusBatch(
        projects.slice(i, i + STATUS_PROJECTS_PER_QUERY),
        result,
      );
    }
    return result;
  }

  private async fetchWorkItemStatusBatch(
    projects: Array<[string, Set<number>]>,
    result: Map<string, GitlabWorkItemStatus | null>,
  ): Promise<void> {
    // Build aliased query fragments. Aliases are p_<index> to avoid the need
    // to escape special characters from the project path.
    const aliases: Array<{ alias: string; path: string }> = [];
    const variables: Record<string, unknown> = {};
    const fragments: string[] = [];
    projects.forEach(([path, iids], idx) => {
      const alias = `p_${idx}`;
      const pathVar = `path${idx}`;
      const iidsVar = `iids${idx}`;
      variables[pathVar] = path;
      variables[iidsVar] = Array.from(iids).map((n) => String(n));
      fragments.push(
        `${alias}: project(fullPath: $${pathVar}) { workItems(iids: $${iidsVar}) { nodes { iid widgets { ... on WorkItemWidgetStatus { status { id name color iconName } } } } } }`,
      );
      aliases.push({ alias, path });
    });
    // workItems(iids:) expects [String!] on this GitLab version (NOT [ID!]).
    const argSig = aliases
      .map((_, i) => `$path${i}: ID!, $iids${i}: [String!]!`)
      .join(", ");
    const query = `query Statuses(${argSig}) { ${fragments.join(" ")} }`;

    interface StatusNode {
      iid: string;
      widgets: Array<{ status?: GitlabWorkItemStatus | null }>;
    }
    type ProjectNodes = { workItems: { nodes: StatusNode[] } } | null;
    const data = await this.graphql<Record<string, ProjectNodes>>(
      query,
      variables,
    );

    for (const { alias, path } of aliases) {
      const project = data[alias];
      if (!project) continue;
      for (const node of project.workItems.nodes) {
        const widget = node.widgets.find(
          (w): w is { status?: GitlabWorkItemStatus | null } =>
            "status" in (w as object),
        );
        const status = widget?.status ?? null;
        result.set(`${path}#${node.iid}`, status);
      }
    }
  }

  /**
   * Set (or clear) the parent of a work item. GitLab models parent/child
   * ("child items") on work items via GraphQL, not the REST issues API, so
   * both ends are resolved from (projectPath, iid) to global work-item ids
   * first, then `workItemUpdate` runs with the hierarchy widget. Pass
   * `parent: null` to detach the child from its current parent.
   */
  async setWorkItemParent(
    childProjectPath: string,
    childIid: number,
    parent: { projectPath: string; iid: number } | null,
  ): Promise<GitlabWorkItemParentResult> {
    interface GidNode {
      id: string;
      iid: string;
    }
    type ResolveData = Record<
      string,
      { workItems: { nodes: GidNode[] } } | null
    >;

    // workItems(iids:) expects [String!] (NOT [ID!]); project fullPath is ID!.
    const resolveVariables: Record<string, unknown> = {
      childPath: childProjectPath,
      childIids: [String(childIid)],
    };
    const fragments = [
      "child: project(fullPath: $childPath) { workItems(iids: $childIids) { nodes { id iid } } }",
    ];
    const argSig = ["$childPath: ID!", "$childIids: [String!]!"];
    if (parent) {
      resolveVariables.parentPath = parent.projectPath;
      resolveVariables.parentIids = [String(parent.iid)];
      fragments.push(
        "parent: project(fullPath: $parentPath) { workItems(iids: $parentIids) { nodes { id iid } } }",
      );
      argSig.push("$parentPath: ID!", "$parentIids: [String!]!");
    }
    const resolved = await this.graphql<ResolveData>(
      `query ResolveWorkItems(${argSig.join(", ")}) { ${fragments.join(" ")} }`,
      resolveVariables,
    );

    const url = this.graphqlUrl();
    const childGid = resolved.child?.workItems.nodes[0]?.id;
    if (!childGid) {
      throw new GitlabError(
        `Work item ${childProjectPath}#${childIid} not found (or the token cannot see it).`,
        404,
        url,
      );
    }
    let parentGid: string | null = null;
    if (parent) {
      parentGid = resolved.parent?.workItems.nodes[0]?.id ?? null;
      if (!parentGid) {
        throw new GitlabError(
          `Parent work item ${parent.projectPath}#${parent.iid} not found (or the token cannot see it).`,
          404,
          url,
        );
      }
    }

    const input = { id: childGid, hierarchyWidget: { parentId: parentGid } };
    process.stderr.write(
      `[WRITE] GRAPHQL workItemUpdate ${url} payload=${JSON.stringify(input)}\n`,
    );

    interface ParentNode {
      iid: string;
      title: string;
      webUrl: string;
      workItemType: { name: string } | null;
    }
    interface MutationData {
      workItemUpdate: {
        errors: string[];
        workItem: (ParentNode & {
          widgets: Array<{ parent?: ParentNode | null }>;
        }) | null;
      } | null;
    }
    const data = await this.graphql<MutationData>(
      "mutation SetWorkItemParent($input: WorkItemUpdateInput!) { workItemUpdate(input: $input) { errors workItem { iid title webUrl workItemType { name } widgets { ... on WorkItemWidgetHierarchy { parent { iid title webUrl workItemType { name } } } } } } }",
      { input },
    );

    const payload = data.workItemUpdate;
    if (payload && payload.errors.length > 0) {
      throw new GitlabError(
        `GitLab rejected the parent change: ${payload.errors.join("; ")}`,
        200,
        url,
        payload,
      );
    }
    const workItem = payload?.workItem;
    if (!workItem) {
      throw new GitlabError(
        "GitLab returned no work item from workItemUpdate — the mutation may not be supported on this instance.",
        200,
        url,
        data,
      );
    }
    const hierarchy = workItem.widgets.find(
      (w): w is { parent?: ParentNode | null } => "parent" in (w as object),
    );
    const parentNode = hierarchy?.parent ?? null;
    return {
      child: summarizeWorkItem(workItem),
      parent: parentNode ? summarizeWorkItem(parentNode) : null,
    };
  }

  /**
   * Convert a work item to a different type (Issue → Task / Incident /
   * Epic / …) via the GraphQL workItemConvert mutation. Type ids are
   * instance-specific, so the project's available types are fetched
   * alongside the work item gid and the requested name is matched
   * case-insensitively (underscores/hyphens tolerated, so "test_case"
   * matches "Test Case").
   */
  async changeWorkItemType(
    projectPath: string,
    iid: number,
    newTypeName: string,
  ): Promise<{ item: GitlabWorkItemSummary; previous_type: string }> {
    interface ResolveData {
      project: {
        workItems: {
          nodes: Array<{
            id: string;
            iid: string;
            workItemType: { name: string } | null;
          }>;
        };
        workItemTypes: { nodes: Array<{ id: string; name: string }> };
      } | null;
    }
    // workItems(iids:) expects [String!] (NOT [ID!]); project fullPath is ID!.
    const resolved = await this.graphql<ResolveData>(
      "query ResolveConvert($path: ID!, $iids: [String!]!) { project(fullPath: $path) { workItems(iids: $iids) { nodes { id iid workItemType { name } } } workItemTypes { nodes { id name } } } }",
      { path: projectPath, iids: [String(iid)] },
    );

    const url = this.graphqlUrl();
    const node = resolved.project?.workItems.nodes[0];
    if (!node) {
      throw new GitlabError(
        `Work item ${projectPath}#${iid} not found (or the token cannot see it).`,
        404,
        url,
      );
    }
    const types = resolved.project?.workItemTypes.nodes ?? [];
    const normalize = (s: string) =>
      s.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
    const target = types.find(
      (t) => normalize(t.name) === normalize(newTypeName),
    );
    if (!target) {
      const available = types.map((t) => t.name).join(", ");
      throw new GitlabError(
        `Unknown work item type "${newTypeName}". Types available on this instance: ${available}.`,
        404,
        url,
      );
    }
    const previousType = node.workItemType?.name ?? "unknown";
    if (normalize(previousType) === normalize(target.name)) {
      throw new GitlabError(
        `Work item ${projectPath}#${iid} is already of type "${previousType}" — nothing to convert.`,
        200,
        url,
      );
    }

    const input = { id: node.id, workItemTypeId: target.id };
    process.stderr.write(
      `[WRITE] GRAPHQL workItemConvert ${url} payload=${JSON.stringify(input)}\n`,
    );

    interface MutationData {
      workItemConvert: {
        errors: string[];
        workItem: {
          iid: string;
          title: string;
          webUrl: string;
          workItemType: { name: string } | null;
        } | null;
      } | null;
    }
    const data = await this.graphql<MutationData>(
      "mutation ConvertWorkItem($input: WorkItemConvertInput!) { workItemConvert(input: $input) { errors workItem { iid title webUrl workItemType { name } } } }",
      { input },
    );

    const payload = data.workItemConvert;
    if (payload && payload.errors.length > 0) {
      throw new GitlabError(
        `GitLab rejected the type change: ${payload.errors.join("; ")}`,
        200,
        url,
        payload,
      );
    }
    const workItem = payload?.workItem;
    if (!workItem) {
      throw new GitlabError(
        "GitLab returned no work item from workItemConvert — the mutation may not be supported on this instance.",
        200,
        url,
        data,
      );
    }
    return { item: summarizeWorkItem(workItem), previous_type: previousType };
  }

  async getFileContentRaw(
    projectId: ProjectId,
    filePath: string,
    ref: string,
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const params = new URLSearchParams({ ref });
    const response = await this.requestRaw(
      `/projects/${encodeProjectId(projectId)}/repository/files/${urlEncodePath(filePath)}/raw?${params.toString()}`,
    );
    const ab = await response.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      contentType: response.headers.get("Content-Type"),
    };
  }

  /**
   * Download a markdown upload (image / attachment pasted into an issue,
   * MR, or comment) by the secret + filename from its `/uploads/...` URL.
   * The web URL ignores PRIVATE-TOKEN, so this goes through the API
   * endpoint added in GitLab 17.4 (Guest role is enough).
   */
  async getProjectUploadRaw(
    projectId: ProjectId,
    secret: string,
    filename: string,
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const response = await this.requestRaw(
      `/projects/${encodeProjectId(projectId)}/uploads/${encodeURIComponent(secret)}/${encodeURIComponent(filename)}`,
    );
    const ab = await response.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      contentType: response.headers.get("Content-Type"),
    };
  }

  async listRepositoryTree(
    projectId: ProjectId,
    options: {
      path?: string;
      ref?: string;
      recursive?: boolean;
      perPage?: number;
    } = {},
  ): Promise<{
    entries: GitlabTreeEntry[];
    truncated: boolean;
    pagesFetched: number;
  }> {
    const perPage = options.perPage ?? 100;
    const ref = options.ref ?? "HEAD";
    const recursive = options.recursive ?? false;
    const all: GitlabTreeEntry[] = [];
    let pagesFetched = 0;
    let truncated = false;
    const MAX_PAGES = 5;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        ref,
        recursive: String(recursive),
        per_page: String(perPage),
        page: String(page),
      });
      if (options.path) params.set("path", options.path);
      const batch = await this.request<GitlabTreeEntry[]>(
        `/projects/${encodeProjectId(projectId)}/repository/tree?${params.toString()}`,
      );
      pagesFetched = page;
      all.push(...batch);
      if (batch.length < perPage) break;
      if (page === MAX_PAGES) truncated = true;
    }
    return { entries: all, truncated, pagesFetched };
  }

  async getPipelineJobs(
    projectId: ProjectId,
    pipelineId: number,
    scope?: PipelineJobScope,
  ): Promise<GitlabPipelineJob[]> {
    const params = new URLSearchParams({ per_page: "100" });
    if (scope) params.append("scope[]", scope);
    return this.request<GitlabPipelineJob[]>(
      `/projects/${encodeProjectId(projectId)}/pipelines/${pipelineId}/jobs?${params.toString()}`,
    );
  }

  async getJob(
    projectId: ProjectId,
    jobId: number,
  ): Promise<GitlabPipelineJob> {
    return this.request<GitlabPipelineJob>(
      `/projects/${encodeProjectId(projectId)}/jobs/${jobId}`,
    );
  }

  async getJobLog(projectId: ProjectId, jobId: number): Promise<string> {
    const response = await this.requestRaw(
      `/projects/${encodeProjectId(projectId)}/jobs/${jobId}/trace`,
    );
    return response.text();
  }

  async searchProjectBlobs(
    projectId: ProjectId,
    query: string,
    options: { ref?: string; perPage?: number } = {},
  ): Promise<GitlabBlobMatch[]> {
    const params = new URLSearchParams({
      scope: "blobs",
      search: query,
      per_page: String(options.perPage ?? 30),
    });
    if (options.ref) params.set("ref", options.ref);
    return this.request<GitlabBlobMatch[]>(
      `/projects/${encodeProjectId(projectId)}/search?${params.toString()}`,
    );
  }

  async searchGlobalBlobs(
    query: string,
    perPage = 30,
  ): Promise<GitlabBlobMatch[]> {
    const params = new URLSearchParams({
      scope: "blobs",
      search: query,
      per_page: String(perPage),
    });
    return this.request<GitlabBlobMatch[]>(`/search?${params.toString()}`);
  }

  async searchProjects(
    query: string,
    perPage = 20,
  ): Promise<GitlabProjectRef[]> {
    const params = new URLSearchParams({
      search: query,
      per_page: String(perPage),
      order_by: "last_activity_at",
      sort: "desc",
      simple: "true",
    });
    return this.request<GitlabProjectRef[]>(`/projects?${params.toString()}`);
  }

  /**
   * POST a GraphQL query (with optional variables) to GitLab's GraphQL
   * endpoint. URL is derived from the REST baseUrl by replacing the
   * `/api/vN` segment with `/api/graphql`. Throws GitlabError if the
   * response carries an `errors` array, so the same wrap() pipeline
   * surfaces failures in the tool output.
   */
  private graphqlUrl(): string {
    return this.baseUrl.replace(/\/api\/v\d+\/?$/, "/api/graphql");
  }

  private async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const url = this.graphqlUrl();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": this.token,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          ...(variables !== undefined ? { variables } : {}),
        }),
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new GitlabError(`Network error calling GitLab: ${cause}`, 0, url);
    }
    if (!response.ok) {
      const body = await safeReadBody(response);
      const message = formatErrorMessage(response, body);
      throw new GitlabError(message, response.status, url, body);
    }
    const body = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (body.errors && body.errors.length > 0) {
      const summary = body.errors.map((e) => e.message).join("; ");
      throw new GitlabError(`GitLab GraphQL error: ${summary}`, 200, url, body);
    }
    if (body.data === undefined) {
      throw new GitlabError(
        "GitLab GraphQL response had no `data` field",
        200,
        url,
        body,
      );
    }
    return body.data;
  }

  /**
   * Like `request<T>` but returns the raw `Response` for callers that need
   * to consume the body as bytes or text (file content, job logs).
   * Same auth, same error formatting on non-2xx.
   */
  private async requestRaw(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          "PRIVATE-TOKEN": this.token,
          Accept: "*/*",
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new GitlabError(`Network error calling GitLab: ${cause}`, 0, url);
    }
    if (response.ok) return response;
    const body = await safeReadBody(response);
    const message = formatErrorMessage(response, body);
    throw new GitlabError(message, response.status, url, body);
  }

  /**
   * Wrapper for state-changing GitLab calls. Always logs to stderr with a
   * [WRITE] prefix — this is the paper trail for actions that mutate
   * GitLab state, on by default regardless of any DEBUG flag.
   */
  private async requestWrite<T>(
    path: string,
    method: "POST" | "PUT" | "DELETE",
    payload: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    process.stderr.write(
      `[WRITE] ${method} ${url} payload=${JSON.stringify(payload)}\n`,
    );
    return this.request<T>(path, {
      method,
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          "PRIVATE-TOKEN": this.token,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new GitlabError(`Network error calling GitLab: ${cause}`, 0, url);
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await safeReadBody(response);
    const message = formatErrorMessage(response, body);
    throw new GitlabError(message, response.status, url, body);
  }
}

function summarizeWorkItem(node: {
  iid: string;
  title: string;
  webUrl: string;
  workItemType: { name: string } | null;
}): GitlabWorkItemSummary {
  return {
    iid: node.iid,
    title: node.title,
    type: node.workItemType?.name ?? "unknown",
    web_url: node.webUrl,
  };
}

function targetSegment(target: TimeTrackingTarget): "issues" | "merge_requests" {
  return target === "issue" ? "issues" : "merge_requests";
}

function encodeProjectId(projectId: ProjectId): string {
  if (typeof projectId === "number") {
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new Error(`Invalid project_id: ${projectId}`);
    }
    return String(projectId);
  }
  const trimmed = projectId.trim();
  if (!trimmed) throw new Error("project_id must not be empty");
  // All-digit string still hits the numeric fast path; otherwise delegate
  // to the shared path encoder.
  return /^\d+$/.test(trimmed) ? trimmed : urlEncodePath(trimmed);
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}

function formatErrorMessage(response: Response, body: unknown): string {
  const detail = extractDetail(body);
  switch (response.status) {
    case 401:
      return `GitLab returned 401 Unauthorized. The GITLAB_TOKEN is missing, expired, or lacks the required scope (need \`api\`).${detail ? ` Detail: ${detail}` : ""}`;
    case 403:
      return `GitLab returned 403 Forbidden. The token is valid but not authorized for this resource.${detail ? ` Detail: ${detail}` : ""}`;
    case 404:
      return `GitLab returned 404 Not Found. The resource does not exist or the token cannot see it.${detail ? ` Detail: ${detail}` : ""}`;
    case 429: {
      const retryAfter = response.headers.get("retry-after");
      return `GitLab rate limit hit (429).${retryAfter ? ` Retry after ${retryAfter}s.` : ""}${detail ? ` Detail: ${detail}` : ""}`;
    }
    default:
      if (response.status >= 500) {
        return `GitLab server error ${response.status} ${response.statusText}.${detail ? ` Detail: ${detail}` : ""}`;
      }
      return `GitLab request failed: ${response.status} ${response.statusText}.${detail ? ` Detail: ${detail}` : ""}`;
  }
}

function extractDetail(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return body.slice(0, 300);
  if (typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const candidate = obj.message ?? obj.error ?? obj.error_description;
    if (typeof candidate === "string") return candidate;
    try {
      return JSON.stringify(candidate ?? body).slice(0, 300);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
