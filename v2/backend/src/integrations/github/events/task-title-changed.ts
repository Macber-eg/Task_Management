import { Logger } from "@nestjs/common";
import type {
  PluginContext,
  TaskTitleChangedEvent,
} from "../../core/task-events";
import { findLinkedTask } from "../../links/integration-task-scope";
import { syncLatestTaskValue } from "../../links/sync-latest-task-value";
import type { GitHubDeps } from "../github-deps";
import { findSyncableIssue } from "./github-issue-link";
import { sameTextSyncedFromGitHub } from "./same-text-synced-from-github";

const logger = new Logger("GitHubTaskTitleChanged");

export async function handleTaskTitleChanged(
  deps: GitHubDeps,
  event: TaskTitleChangedEvent,
  context: PluginContext,
): Promise<void> {
  const target = await findSyncableIssue(deps, event.taskId, context);
  if (!target) return;
  const { config, link, issueNumber } = target;

  try {
    const current = await findLinkedTask(
      deps.db,
      event.taskId,
      context.projectId,
    );
    if (!current || current.title !== event.newTitle) return;
    if (sameTextSyncedFromGitHub(link.metadata, "title", event.newTitle))
      return;

    const octokit = await deps.github.verifiedInstallationOctokit(config);
    const owner = config.repositoryOwner;
    const repo = config.repositoryName;
    await syncLatestTaskValue(
      deps.db,
      deps.events,
      event.taskId,
      context.projectId,
      link,
      "title",
      event.newTitle,
      async (value) => {
        const response = await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          title: value,
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
        ).data.title,
      { type: "github", config: JSON.stringify(config) },
    );
  } catch (error) {
    logger.error(`Failed to update GitHub issue title: ${String(error)}`);
  }
}
