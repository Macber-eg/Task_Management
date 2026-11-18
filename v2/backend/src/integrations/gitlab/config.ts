import {
  boolean,
  ConfigValidationError,
  type ConfigSchema,
  check,
  object,
  optional,
  parse,
  pipe,
  string,
  stringify,
  trim,
  url,
} from "../chat/shared/config-schema";
import type { BranchMatchConfig } from "../git-shared/branch-patterns";
import {
  nonEmptyMessage,
  syncRulesConfig,
} from "../git-shared/sync-rules-config";
import type { SyncRules } from "../sync/rules";
import { normalizeGitlabBaseUrl, normalizeProjectPath } from "./gitlab-url";

export type GitlabTokenType = "private" | "bearer";

export type GitlabConfig = BranchMatchConfig & {
  baseUrl: string;
  accessToken: string;
  tokenType?: GitlabTokenType;
  projectPath: string;
  webhookSecret?: string;
  syncRules?: SyncRules;
  commentTaskLinkOnGitlabIssue?: boolean;
  statusTransitions?: {
    onBranchPush?: string;
    onPROpen?: string;
    onPRMerge?: string;
  };
};

const required = () =>
  pipe(
    string(),
    trim(),
    check((value) => value.length > 0, nonEmptyMessage),
  );

// valibot's `picklist`.
function picklist(options: readonly string[]): ConfigSchema {
  return {
    kind: "schema",
    run(value) {
      if (typeof value === "string" && options.includes(value))
        return { value, typed: true };
      return {
        value,
        typed: false,
        issues: [
          `Invalid type: Expected ${options.map((option) => `"${option}"`).join(" | ")} but received ${stringify(value)}`,
        ],
      };
    },
  };
}

export const gitlabConfigSchema = object({
  baseUrl: pipe(string(), url()),
  accessToken: required(),
  tokenType: optional(picklist(["private", "bearer"])),
  projectPath: required(),
  webhookSecret: optional(string()),
  syncRules: syncRulesConfig(),
  branchPattern: optional(string()),
  customBranchRegex: optional(string()),
  commentTaskLinkOnGitlabIssue: optional(boolean()),
  statusTransitions: optional(
    object({
      onBranchPush: optional(string()),
      onPROpen: optional(string()),
      onPRMerge: optional(string()),
    }),
  ),
});

export async function validateGitlabConfig(
  config: unknown,
): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    parse(gitlabConfigSchema, config);
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

export const GITLAB_CLOUD_URL = "https://gitlab.com";

export const defaultGitlabConfig: Partial<GitlabConfig> = {
  branchPattern: "{slug}-{number}",
  commentTaskLinkOnGitlabIssue: true,
  statusTransitions: {
    onBranchPush: "in-progress",
    onPROpen: "in-review",
    onPRMerge: "done",
  },
};

export function tokenTypeOf(config: {
  tokenType?: GitlabTokenType;
}): GitlabTokenType {
  return config.tokenType === "bearer" ? "bearer" : "private";
}

export function getDefaultGitlabConfig(
  baseUrl: string,
  accessToken: string,
  tokenType: GitlabTokenType,
  projectPath: string,
  webhookSecret: string,
): GitlabConfig {
  return {
    baseUrl: normalizeGitlabBaseUrl(baseUrl),
    accessToken,
    tokenType,
    projectPath: normalizeProjectPath(projectPath),
    webhookSecret,
    ...defaultGitlabConfig,
  };
}
