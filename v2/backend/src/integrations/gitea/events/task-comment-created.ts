import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type {
  PluginContext,
  TaskCommentCreatedEvent,
} from "../../core/task-events";
import { errorText } from "../../git-shared/error-text";
import { findExternalLinkByTaskAndType } from "../../links/external-link-queries";
import { dispatchIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { createGiteaClient } from "../client/gitea-client";
import { markKaneoComment } from "../comment-origin";
import type { GiteaConfig } from "../config";

const logger = new Logger("GiteaTaskCommentCreated");

/** Posts a Kaneo comment on the linked issue, marked so its webhook is ignored. */
export async function handleTaskCommentCreated(
  db: EntityManager,
  event: TaskCommentCreatedEvent,
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

  const existingLink = await findExternalLinkByTaskAndType(
    db,
    event.taskId,
    context.integrationId,
    "issue",
  );

  if (!existingLink) {
    return;
  }

  try {
    const client = createGiteaClient(config);
    if (!/^\d+$/.test(existingLink.externalId)) {
      logger.error(
        `Skipping Gitea comment sync for invalid external issue id (task ${event.taskId})`,
      );
      return;
    }

    const issueNumber = Number(existingLink.externalId);

    if (!Number.isFinite(issueNumber) || issueNumber < 1) {
      logger.error(
        `Skipping Gitea comment sync for invalid issue number (task ${event.taskId})`,
      );
      return;
    }

    await dispatchIssueWrite(
      db,
      existingLink,
      JSON.stringify(context.config),
      () =>
        client.createIssueComment(
          repositoryOwner,
          repositoryName,
          issueNumber,
          markKaneoComment(event.comment),
        ),
    );
  } catch (error) {
    logger.error(`Failed to create Gitea comment: ${errorText(error)}`);
  }
}
