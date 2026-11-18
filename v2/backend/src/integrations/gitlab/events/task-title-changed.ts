import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { PluginContext, TaskTitleChangedEvent } from "../../core/task-events";
import { updateExternalLink } from "../../links/external-link-writes";
import { createIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { createGitlabClient } from "../client/gitlab-client";
import type { GitlabConfig } from "../config";
import { errorText } from "../../git-shared/error-text";
import {
  isEchoOf,
  parseLinkSyncMetadata,
  withLastSync,
} from "../sync/link-sync";
import { findIssueLink } from "./find-issue-link";

const logger = new Logger("GitlabTaskTitle");

/** Writes the task's new title to its GitLab issue, unless GitLab sent it. */
export async function handleTaskTitleChanged(
  db: EntityManager,
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

  const config = context.config as GitlabConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  try {
    const issueLink = await findIssueLink(db, event.taskId, context);
    if (!issueLink) {
      return;
    }
    const write = createIssueWrite(
      db,
      { ...issueLink, taskId: event.taskId },
      JSON.stringify(context.config),
    );

    const metadata = parseLinkSyncMetadata(issueLink.metadata, {
      externalLinkId: issueLink.id,
      field: "title",
    });

    if (isEchoOf(metadata.lastSync?.title, "gitlab", event.newTitle)) {
      return;
    }

    const issueIid = Number.parseInt(issueLink.externalId, 10);
    if (Number.isNaN(issueIid)) {
      logger.warn(
        `Skipping GitLab title sync for invalid issue iid (link ${issueLink.id})`,
      );
      return;
    }

    await write(() =>
      createGitlabClient(config).updateIssue(config.projectPath, issueIid, {
        title: event.newTitle,
      }),
    );

    await updateExternalLink(db, issueLink.id, {
      title: event.newTitle,
      metadata: withLastSync(metadata, "title", "kaneo", event.newTitle),
    });
  } catch (error) {
    logger.error(`Failed to update GitLab issue title: ${errorText(error)}`);
  }
}
