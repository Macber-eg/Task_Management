import { Logger } from "@nestjs/common";
import type {
  PluginContext,
  TaskPriorityChangedEvent,
} from "../../core/task-events";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import type { GitHubDeps } from "../github-deps";
import { githubIssueAccess } from "../issues/github-issue-access";
import { sendIssueLabelChanges } from "../labels/send-issue-label-changes";
import { findSyncableIssue } from "./github-issue-link";

const logger = new Logger("GitHubTaskPriorityChanged");

export async function handleTaskPriorityChanged(
  deps: GitHubDeps,
  event: TaskPriorityChangedEvent,
  context: PluginContext,
): Promise<void> {
  const target = await findSyncableIssue(deps, event.taskId, context);
  if (!target) return;
  const { config, link, issueNumber } = target;

  try {
    const octokit = await deps.github.verifiedInstallationOctokit(config);
    await syncTaskFieldLabels(
      deps.db,
      await githubIssueAccess(
        deps.github,
        { config: JSON.stringify(context.config) },
        { externalId: link.externalId, taskId: event.taskId },
      ),
      event.taskId,
      context,
      link,
      "priority",
      sendIssueLabelChanges(
        octokit,
        config.repositoryOwner,
        config.repositoryName,
        issueNumber,
      ),
    );
  } catch (error) {
    logger.error(`Failed to update GitHub issue priority: ${String(error)}`);
  }
}
