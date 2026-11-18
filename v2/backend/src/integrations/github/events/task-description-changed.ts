import { Logger } from "@nestjs/common";
import type {
  PluginContext,
  TaskDescriptionChangedEvent,
} from "../../core/task-events";
import { findLinkedTask } from "../../links/integration-task-scope";
import {
  formatIssueBody,
  formatTaskDescriptionFromIssue,
} from "../../links/issue-format";
import { syncLatestTaskValue } from "../../links/sync-latest-task-value";
import type { GitHubDeps } from "../github-deps";
import { findSyncableIssue } from "./github-issue-link";
import { sameTextSyncedFromGitHub } from "./same-text-synced-from-github";

const logger = new Logger("GitHubTaskDescriptionChanged");

export async function handleTaskDescriptionChanged(
  deps: GitHubDeps,
  event: TaskDescriptionChangedEvent,
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
    if (
      !current ||
      (current.description || "") !== (event.newDescription || "")
    )
      return;
    const description = event.newDescription || "";
    if (sameTextSyncedFromGitHub(link.metadata, "description", description))
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
      "description",
      description,
      async (value) => {
        const response = await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          body: formatIssueBody(value, event.taskId),
        });
        return response?.data?.updated_at;
      },
      async () =>
        formatTaskDescriptionFromIssue(
          (
            await octokit.rest.issues.get({
              owner,
              repo,
              issue_number: issueNumber,
            })
          ).data.body ?? null,
          event.taskId,
        ),
      { type: "github", config: JSON.stringify(config) },
    );
  } catch (error) {
    logger.error(
      `Failed to update GitHub issue description: ${String(error)}`,
    );
  }
}
