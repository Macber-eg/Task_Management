import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../../events/event-bus";
import type {
  PluginContext,
  TaskTitleChangedEvent,
} from "../../core/task-events";
import { errorText } from "../../git-shared/error-text";
import { findLinkedTask } from "../../links/integration-task-scope";
import { parseLinkMetadata } from "../../links/parse-link-metadata";
import type { SyncStamp } from "../../links/sync-echo";
import { syncLatestTaskValue } from "../../links/sync-latest-task-value";
import { canSyncTask } from "../../sync/eligibility";
import { createGiteaClient } from "../client/gitea-client";
import type { GiteaConfig } from "../config";
import { findIssueLink } from "./find-issue-link";

const logger = new Logger("GiteaTaskTitleChanged");

/** Writes the new task title to the linked issue unless Gitea sent it. */
export async function handleTaskTitleChanged(
  db: EntityManager,
  events: EventBus,
  event: TaskTitleChangedEvent,
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
    const current = await findLinkedTask(db, event.taskId, context.projectId);
    if (!current || current.title !== event.newTitle) return;

    const issueLink = await findIssueLink(db, event.taskId, context);
    if (!issueLink) {
      return;
    }

    const metadata = parseLinkMetadata<{ lastSync?: { title?: SyncStamp } }>(
      issueLink.metadata,
      { externalLinkId: issueLink.id, source: "gitea_title_sync" },
    );
    const lastTitleSync = metadata.lastSync?.title;
    if (
      lastTitleSync?.value === event.newTitle &&
      lastTitleSync.source === "gitea"
    ) {
      return;
    }

    const client = createGiteaClient(config);
    const issueNumber = Number.parseInt(issueLink.externalId, 10);
    if (Number.isNaN(issueNumber)) {
      logger.warn(
        `Skipping Gitea title sync for invalid issue number (link ${issueLink.id}, task ${issueLink.taskId})`,
      );
      return;
    }

    await syncLatestTaskValue(
      db,
      events,
      event.taskId,
      context.projectId,
      issueLink,
      "title",
      event.newTitle,
      async (value) => {
        const response = await client.updateIssue(
          repositoryOwner,
          repositoryName,
          issueNumber,
          { title: value },
        );
        return response?.updated_at;
      },
      async () =>
        (await client.getIssue(repositoryOwner, repositoryName, issueNumber))
          .title,
      { type: "gitea", config: JSON.stringify(config) },
    );
  } catch (error) {
    logger.error(`Failed to update Gitea issue title: ${errorText(error)}`);
  }
}
