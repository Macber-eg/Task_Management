import { Logger } from "@nestjs/common";
import type {
  PluginContext,
  TaskStatusChangedEvent,
} from "../../core/task-events";
import { isTaskInFinalState } from "../../links/integration-tasks";
import { syncLatestTaskValue } from "../../links/sync-latest-task-value";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import type { GitHubDeps } from "../github-deps";
import { githubIssueAccess } from "../issues/github-issue-access";
import { sendIssueLabelChanges } from "../labels/send-issue-label-changes";
import { findSyncableIssue } from "./github-issue-link";

const logger = new Logger("GitHubTaskStatusChanged");

/** Syncs the `status:` label, then closes or reopens the issue on a final-column crossing. */
export async function handleTaskStatusChanged(
  deps: GitHubDeps,
  event: TaskStatusChangedEvent,
  context: PluginContext,
): Promise<void> {
  const target = await findSyncableIssue(deps, event.taskId, context);
  if (!target) return;
  const { config, link, issueNumber } = target;
  const owner = config.repositoryOwner;
  const repo = config.repositoryName;

  try {
    const octokit = await deps.github.verifiedInstallationOctokit(config);
    const currentValue = await syncTaskFieldLabels(
      deps.db,
      await githubIssueAccess(
        deps.github,
        { config: JSON.stringify(context.config) },
        { externalId: link.externalId, taskId: event.taskId },
      ),
      event.taskId,
      context,
      link,
      "status",
      sendIssueLabelChanges(octokit, owner, repo, issueNumber),
    );
    if (currentValue === undefined) return;
    const closing = await isTaskInFinalState(deps.db, {
      projectId: event.projectId,
      status: currentValue,
      columnId: null,
    });
    const reopening =
      !closing &&
      (await isTaskInFinalState(deps.db, {
        projectId: event.projectId,
        status: event.oldStatus,
        columnId: null,
      }));
    if (!closing && !reopening) return;
    await syncLatestTaskValue(
      deps.db,
      deps.events,
      event.taskId,
      event.projectId,
      link,
      "state",
      closing ? "closed" : "open",
      async (value) => {
        const response = await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          state: value === "closed" ? "closed" : "open",
        });
        return response?.data?.updated_at;
      },
      async () =>
        (
          await octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber,
          })
        ).data.state ?? "open",
      { type: "github", config: JSON.stringify(config) },
    );
  } catch (error) {
    logger.error(`Failed to update GitHub issue status: ${String(error)}`);
  }
}
