import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type {
  PluginContext,
  TaskDescriptionChangedEvent,
} from "../../core/task-events";
import { updateExternalLink } from "../../links/external-link-writes";
import { formatIssueBody } from "../../links/issue-format";
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

const logger = new Logger("GitlabTaskDescription");

/** Writes the task's new description (with the task footer) to its GitLab issue. */
export async function handleTaskDescriptionChanged(
  db: EntityManager,
  event: TaskDescriptionChangedEvent,
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
      field: "description",
    });

    const newDescription = event.newDescription ?? "";

    if (isEchoOf(metadata.lastSync?.description, "gitlab", newDescription)) {
      return;
    }

    const issueIid = Number.parseInt(issueLink.externalId, 10);
    if (Number.isNaN(issueIid)) {
      logger.warn(
        `Skipping GitLab description sync for invalid issue iid (link ${issueLink.id})`,
      );
      return;
    }

    const issueDescription = formatIssueBody(newDescription, event.taskId);

    await write(() =>
      createGitlabClient(config).updateIssue(config.projectPath, issueIid, {
        description: issueDescription,
      }),
    );

    await updateExternalLink(db, issueLink.id, {
      metadata: withLastSync(
        metadata,
        "description",
        "kaneo",
        issueDescription,
      ),
    });
  } catch (error) {
    logger.error(
      `Failed to update GitLab issue description: ${errorText(error)}`,
    );
  }
}
