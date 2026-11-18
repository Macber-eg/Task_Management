import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type {
  PluginContext,
  TaskCommentCreatedEvent,
} from "../../core/task-events";
import { findExternalLinkByTaskAndType } from "../../links/external-link-queries";
import { updateExternalLink } from "../../links/external-link-writes";
import { dispatchIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { createGitlabClient } from "../client/gitlab-client";
import type { GitlabConfig } from "../config";
import { errorText } from "../../git-shared/error-text";
import { parseLinkSyncMetadata } from "../sync/link-sync";
import { syncedNoteIds, withSyncedNoteId } from "../sync/synced-notes";

const logger = new Logger("GitlabTaskComment");

/**
 * Posts a task comment as a note on the linked issue and remembers the note
 * id, so its webhook is not imported back as a comment.
 */
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

  const config = context.config as GitlabConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  const existingLink = await findExternalLinkByTaskAndType(
    db,
    event.taskId,
    context.integrationId,
    "issue",
  );

  if (!existingLink) {
    return;
  }

  if (!/^\d+$/.test(existingLink.externalId)) {
    logger.error(
      `Skipping GitLab comment sync for invalid external issue id (task ${event.taskId})`,
    );
    return;
  }

  const issueIid = Number(existingLink.externalId);

  if (!Number.isFinite(issueIid) || issueIid < 1) {
    logger.error(
      `Skipping GitLab comment sync for invalid issue iid (task ${event.taskId})`,
    );
    return;
  }

  try {
    const dispatched = await dispatchIssueWrite(
      db,
      existingLink,
      JSON.stringify(context.config),
      () =>
        createGitlabClient(config).createIssueNote(
          config.projectPath,
          issueIid,
          event.comment,
        ),
    );
    if (!dispatched) return;
    const note = dispatched.value;

    const metadata = parseLinkSyncMetadata(existingLink.metadata, {
      externalLinkId: existingLink.id,
      field: "syncedNoteIds",
    });

    await updateExternalLink(db, existingLink.id, {
      metadata: {
        ...metadata,
        syncedNoteIds: withSyncedNoteId(
          syncedNoteIds(existingLink.metadata),
          note.id,
        ),
      },
    });
  } catch (error) {
    logger.error(`Failed to create GitLab comment: ${errorText(error)}`);
  }
}
