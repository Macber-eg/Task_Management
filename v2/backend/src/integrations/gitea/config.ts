import {
  boolean,
  ConfigValidationError,
  check,
  object,
  optional,
  parse,
  pipe,
  string,
  trim,
  url,
} from "../chat/shared/config-schema";
import type { BranchMatchConfig } from "../git-shared/branch-patterns";
import {
  nonEmptyMessage,
  syncRulesConfig,
} from "../git-shared/sync-rules-config";
import { normalizeGiteaBaseUrl } from "../links/normalize-gitea-base-url";
import type { SyncRules } from "../sync/rules";

export type GiteaConfig = BranchMatchConfig & {
  baseUrl: string;
  accessToken: string;
  repositoryOwner: string;
  repositoryName: string;
  webhookSecret?: string;
  syncRules?: SyncRules;
  commentTaskLinkOnGiteaIssue?: boolean;
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

export const giteaConfigSchema = object({
  baseUrl: pipe(string(), url()),
  accessToken: required(),
  repositoryOwner: required(),
  repositoryName: required(),
  webhookSecret: optional(string()),
  syncRules: syncRulesConfig(),
  branchPattern: optional(string()),
  customBranchRegex: optional(string()),
  commentTaskLinkOnGiteaIssue: optional(boolean()),
  statusTransitions: optional(
    object({
      onBranchPush: optional(string()),
      onPROpen: optional(string()),
      onPRMerge: optional(string()),
    }),
  ),
});

export async function validateGiteaConfig(
  config: unknown,
): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    parse(giteaConfigSchema, config);
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

export const defaultGiteaConfig: Partial<GiteaConfig> = {
  branchPattern: "{slug}-{number}",
  commentTaskLinkOnGiteaIssue: true,
  statusTransitions: {
    onBranchPush: "in-progress",
    onPROpen: "in-review",
    onPRMerge: "done",
  },
};

export function getDefaultGiteaConfig(
  baseUrl: string,
  accessToken: string,
  repositoryOwner: string,
  repositoryName: string,
  webhookSecret: string,
): GiteaConfig {
  return {
    baseUrl: normalizeGiteaBaseUrl(baseUrl),
    accessToken,
    repositoryOwner,
    repositoryName,
    webhookSecret,
    ...defaultGiteaConfig,
  };
}
