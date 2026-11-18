import { Logger } from "@nestjs/common";
import type {
  PluginContext,
  TaskCommentCreatedEvent,
} from "../../core/task-events";
import { findExternalLinkByTaskAndType } from "../../links/external-link-queries";
import { dispatchIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../config/github-config";
import type { GitHubDeps } from "../github-deps";

const logger = new Logger("GitHubTaskCommentCreated");

export async function handleTaskCommentCreated(
  deps: GitHubDeps,
  event: TaskCommentCreatedEvent,
  context: PluginContext,
): Promise<void> {
  const expectedConfig = JSON.stringify(context.config);
  if (
    !(await canSyncTask(
      deps.db,
      event.taskId,
      context.integrationId,
      expectedConfig,
    ))
  )
    return;
  if (!deps.github.app()) return;
  const config = context.config as GitHubConfig;
  if (!hasVerifiedGitHubBinding(config)) return;

  const existingLink = await findExternalLinkByTaskAndType(
    deps.db,
    event.taskId,
    context.integrationId,
    "issue",
  );
  if (!existingLink) return;

  try {
    const octokit = await deps.github.verifiedInstallationOctokit(config);
    const issueNumber = Number.parseInt(existingLink.externalId, 10);
    await dispatchIssueWrite(deps.db, existingLink, expectedConfig, () =>
      octokit.rest.issues.createComment({
        owner: config.repositoryOwner,
        repo: config.repositoryName,
        issue_number: issueNumber,
        body: event.comment,
      }),
    );
  } catch (error) {
    logger.error(`Failed to create GitHub comment: ${String(error)}`);
  }
}
