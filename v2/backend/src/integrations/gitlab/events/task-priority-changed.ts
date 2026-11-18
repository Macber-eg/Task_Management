import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type {
  PluginContext,
  TaskPriorityChangedEvent,
} from "../../core/task-events";
import { canSyncTask } from "../../sync/eligibility";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import type { GitlabConfig } from "../config";
import { errorText } from "../../git-shared/error-text";
import { gitlabIssueAccess } from "../gitlab-issue-access";
import { updateIssueLabelsGitlab } from "../labels/issue-labels";
import { findIssueLink } from "./find-issue-link";

const logger = new Logger("GitlabTaskPriority");

/** Moves the issue's `priority:` label to the task's priority. */
export async function handleTaskPriorityChanged(
  db: EntityManager,
  event: TaskPriorityChangedEvent,
  context: PluginContext,
): Promise<void> {
  if (
    !(await canSyncTask(
      db,
      event.taskId,
      context.integrationId,
      JSON.stringify(context.config),
    ))
  )
    return;

  const config = context.config as GitlabConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  try {
    const issueLink = await findIssueLink(db, event.taskId, context);
    if (!issueLink) {
      return;
    }
    const issueIid = Number.parseInt(issueLink.externalId, 10);
    if (Number.isNaN(issueIid)) {
      return;
    }

    await syncTaskFieldLabels(
      db,
      gitlabIssueAccess(JSON.stringify(context.config), {
        externalId: issueLink.externalId,
        taskId: event.taskId,
      }),
      event.taskId,
      context,
      issueLink,
      "priority",
      (changes, write) =>
        updateIssueLabelsGitlab(config, issueIid, changes, true, write),
    );
  } catch (error) {
    logger.error(`Failed to update GitLab issue priority: ${errorText(error)}`);
  }
}
