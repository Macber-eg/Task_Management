import {
  boolean,
  type ConfigSchema,
  ConfigValidationError,
  number,
  object,
  optional,
  parse,
  string,
} from "../../chat/shared/config-schema";
import type { BranchMatchConfig } from "../../git-shared/branch-patterns";
import { syncRulesConfig } from "../../git-shared/sync-rules-config";
import type { SyncRules } from "../../sync/rules";

export type GitHubConfig = BranchMatchConfig & {
  repositoryOwner: string;
  repositoryName: string;
  installationId: number | null;
  repositoryId?: number;
  verifiedGithubAccountId?: string;
  verifiedByUserId?: string;
  syncRules?: SyncRules;
  commentTaskLinkOnGitHubIssue?: boolean;
  statusTransitions?: {
    onBranchPush?: string;
    onPROpen?: string;
    onPRMerge?: string;
  };
};

/** valibot's `nullable`. */
function nullable(wrapped: ConfigSchema): ConfigSchema {
  return {
    kind: "schema",
    run(value) {
      if (value === null) return { value, typed: true };
      return wrapped.run(value);
    },
  };
}

export const githubConfigSchema = object({
  repositoryOwner: string(),
  repositoryName: string(),
  installationId: nullable(number()),
  repositoryId: optional(number()),
  verifiedGithubAccountId: optional(string()),
  verifiedByUserId: optional(string()),
  syncRules: syncRulesConfig(),
  branchPattern: optional(string()),
  customBranchRegex: optional(string()),
  commentTaskLinkOnGitHubIssue: optional(boolean()),
  statusTransitions: optional(
    object({
      onBranchPush: optional(string()),
      onPROpen: optional(string()),
      onPRMerge: optional(string()),
    }),
  ),
});

/** The config, or null when it does not match the schema. */
export function safeParseGitHubConfig(config: unknown): GitHubConfig | null {
  try {
    return parse<GitHubConfig>(githubConfigSchema, config);
  } catch {
    return null;
  }
}

export async function validateGitHubConfig(
  config: unknown,
): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    parse(githubConfigSchema, config);
    return { valid: true };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return { valid: false, errors: error.issues };
    }
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Invalid config"],
    };
  }
}

export const defaultGitHubConfig: Partial<GitHubConfig> = {
  branchPattern: "{slug}-{number}",
  commentTaskLinkOnGitHubIssue: true,
  statusTransitions: {
    onBranchPush: "in-progress",
    onPROpen: "in-review",
    onPRMerge: "done",
  },
};

export function getDefaultConfig(
  repositoryOwner: string,
  repositoryName: string,
  installationId: number | null = null,
): GitHubConfig {
  return {
    repositoryOwner,
    repositoryName,
    installationId,
    ...defaultGitHubConfig,
  };
}

/** Legacy integrations require explicit re-verification by a repository administrator. */
export function hasVerifiedGitHubBinding(config: GitHubConfig): boolean {
  return (
    Number.isSafeInteger(config.installationId) &&
    (config.installationId ?? 0) > 0 &&
    Number.isSafeInteger(config.repositoryId) &&
    (config.repositoryId ?? 0) > 0 &&
    typeof config.verifiedGithubAccountId === "string" &&
    /^[1-9][0-9]*$/.test(config.verifiedGithubAccountId) &&
    typeof config.verifiedByUserId === "string" &&
    config.verifiedByUserId.length > 0
  );
}
