import type { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import type { PluginContext } from "../../core/task-events";
import { findExternalLinksByTask } from "../../links/external-link-queries";
import { canSyncTask } from "../../sync/eligibility";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../config/github-config";
import type { GitHubDeps } from "../github-deps";

export type GitHubIssueTarget = {
  config: GitHubConfig;
  link: ExternalLinkEntity;
  issueNumber: number;
};

/**
 * The integration's issue link for an outbound task change, when the task
 * may be synced, the App is configured and the binding is verified.
 */
export async function findSyncableIssue(
  deps: GitHubDeps,
  taskId: string,
  context: PluginContext,
): Promise<GitHubIssueTarget | undefined> {
  if (
    !(await canSyncTask(
      deps.db,
      taskId,
      context.integrationId,
      JSON.stringify(context.config),
    ))
  )
    return;
  if (!deps.github.app()) return;
  const config = context.config as GitHubConfig;
  if (!hasVerifiedGitHubBinding(config)) return;
  const link = (await findExternalLinksByTask(deps.db, taskId)).find(
    (candidate) =>
      candidate.integrationId === context.integrationId &&
      candidate.resourceType === "issue",
  );
  if (!link) return;
  return { config, link, issueNumber: Number.parseInt(link.externalId, 10) };
}
