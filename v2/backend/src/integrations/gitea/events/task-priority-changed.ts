import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type {
  PluginContext,
  TaskPriorityChangedEvent,
} from "../../core/task-events";
import { errorText } from "../../git-shared/error-text";
import { canSyncTask } from "../../sync/eligibility";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import type { GiteaConfig } from "../config";
import { giteaIssueAccess } from "../gitea-issue-access";
import { findIssueLink } from "./find-issue-link";
import { sendIssueLabelChanges } from "./sync-issue-labels";

const logger = new Logger("GiteaTaskPriorityChanged");

/** Moves the linked issue's `priority:` label. */
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

  const config = context.config as GiteaConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  try {
    const issueLink = await findIssueLink(db, event.taskId, context);
    if (!issueLink) {
      return;
    }
    const issueNumber = Number.parseInt(issueLink.externalId, 10);

    await syncTaskFieldLabels(
      db,
      giteaIssueAccess(JSON.stringify(context.config), issueLink),
      event.taskId,
      context,
      issueLink,
      "priority",
      (changes, write) =>
        sendIssueLabelChanges(config, issueNumber, changes, write),
    );
  } catch (error) {
    logger.error(`Failed to update Gitea issue priority: ${errorText(error)}`);
  }
}
