const DEFAULT_GITLAB_URL = "https://gitlab.com/api/v4";
const DEFAULT_ACTIONABLE_STATUSES = ["To do", "In progress"];

export interface ServerConfig {
  gitlabUrl: string;
  gitlabToken: string;
  defaultProjectIds: number[];
  enableWrites: boolean;
  actionableStatuses: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const gitlabToken = env.GITLAB_TOKEN?.trim();
  if (!gitlabToken) {
    throw new Error(
      "GITLAB_TOKEN is required. Create a personal access token with the `api` scope on your GitLab instance and set it in the environment.",
    );
  }

  const gitlabUrl = (env.GITLAB_URL?.trim() || DEFAULT_GITLAB_URL).replace(
    /\/+$/,
    "",
  );

  const rawProjectIds = env.DEFAULT_PROJECT_IDS?.trim();
  const defaultProjectIds = rawProjectIds
    ? rawProjectIds
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
          const n = Number(s);
          if (!Number.isInteger(n) || n <= 0) {
            throw new Error(`DEFAULT_PROJECT_IDS contains invalid id: ${s}`);
          }
          return n;
        })
    : [];

  const enableWrites = ["1", "true", "yes"].includes(
    (env.GITLAB_ENABLE_WRITES ?? "").trim().toLowerCase(),
  );

  // ACTIONABLE_STATUSES: comma-separated list of status names that
  // list_my_issues treats as "actionable" by default. Unset → use the
  // GitLab-stock defaults. Empty string → disable the default filter
  // entirely (callers can still pass `status: [...]` explicitly).
  const rawActionable = env.ACTIONABLE_STATUSES;
  let actionableStatuses: string[];
  if (rawActionable === undefined) {
    actionableStatuses = [...DEFAULT_ACTIONABLE_STATUSES];
  } else if (rawActionable.trim() === "") {
    actionableStatuses = [];
  } else {
    actionableStatuses = rawActionable
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return {
    gitlabUrl,
    gitlabToken,
    defaultProjectIds,
    enableWrites,
    actionableStatuses,
  };
}
