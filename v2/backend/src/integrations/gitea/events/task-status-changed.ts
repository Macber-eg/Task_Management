import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../../events/event-bus";
import type {
  PluginContext,
  TaskStatusChangedEvent,
} from "../../core/task-events";
import { errorText } from "../../git-shared/error-text";
import { isTaskInFinalState } from "../../links/integration-tasks";
import { syncLatestTaskValue } from "../../links/sync-latest-task-value";
import { canSyncTask } from "../../sync/eligibility";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import { createGiteaClient } from "../client/gitea-client";
import type { GiteaConfig } from "../config";
import { giteaIssueAccess } from "../gitea-issue-access";
import { findIssueLink } from "./find-issue-link";
import { sendIssueLabelChanges } from "./sync-issue-labels";

const logger = new Logger("GiteaTaskStatusChanged");

/** Moves the issue's `status:` label; closes or reopens it around final columns. */
export async function handleTaskStatusChanged(
  db: EntityManager,
  events: EventBus,
  event: TaskStatusChangedEvent,
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

  const { repositoryOwner, repositoryName } = config;

  try {
    const issueLink = await findIssueLink(db, event.taskId, context);
    if (!issueLink) {
      return;
    }
    const client = createGiteaClient(config);
    const issueNumber = Number.parseInt(issueLink.externalId, 10);

    const currentValue = await syncTaskFieldLabels(
      db,
      giteaIssueAccess(JSON.stringify(context.config), issueLink),
      event.taskId,
      context,
      issueLink,
      "status",
      (changes, write) =>
        sendIssueLabelChanges(config, issueNumber, changes, write),
    );
    if (currentValue === undefined) return;
    const closing = await isTaskInFinalState(db, {
      projectId: event.projectId,
      status: currentValue,
      columnId: null,
    });
    const reopening =
      !closing &&
      (await isTaskInFinalState(db, {
        projectId: event.projectId,
        status: event.oldStatus,
        columnId: null,
      }));
    if (closing || reopening) {
      await syncLatestTaskValue(
        db,
        events,
        event.taskId,
        event.projectId,
        issueLink,
        "state",
        closing ? "closed" : "open",
        async (value) => {
          const response = await client.updateIssue(
            repositoryOwner,
            repositoryName,
            issueNumber,
            { state: value === "closed" ? "closed" : "open" },
          );
          return response?.updated_at;
        },
        async () =>
          (await client.getIssue(repositoryOwner, repositoryName, issueNumber))
            .state ?? "open",
        { type: "gitea", config: JSON.stringify(config) },
      );
    }
  } catch (error) {
    logger.error(`Failed to update Gitea issue status: ${errorText(error)}`);
  }
}
