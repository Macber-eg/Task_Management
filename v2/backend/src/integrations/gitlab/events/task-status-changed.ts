import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type {
  PluginContext,
  TaskStatusChangedEvent,
} from "../../core/task-events";
import { updateExternalLink } from "../../links/external-link-writes";
import { isTaskInFinalState } from "../../links/integration-tasks";
import { createIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import { createGitlabClient } from "../client/gitlab-client";
import type { GitlabConfig } from "../config";
import { errorText } from "../../git-shared/error-text";
import { gitlabIssueAccess } from "../gitlab-issue-access";
import { updateIssueLabelsGitlab } from "../labels/issue-labels";
import { parseLinkSyncMetadata } from "../sync/link-sync";
import { findIssueLink } from "./find-issue-link";

const logger = new Logger("GitlabTaskStatus");

/** Moves the issue's `status:` label, and closes or reopens it across the final column. */
export async function handleTaskStatusChanged(
  db: EntityManager,
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

  // Keep activity and other integrations informed without echoing an issue
  // webhook back to the GitLab project that produced it.
  if (event.sourceIntegrationId === context.integrationId) return;

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
      logger.warn(
        `Skipping GitLab status sync for invalid issue iid (link ${issueLink.id})`,
      );
      return;
    }

    const currentValue = await syncTaskFieldLabels(
      db,
      gitlabIssueAccess(JSON.stringify(context.config), {
        externalId: issueLink.externalId,
        taskId: event.taskId,
      }),
      event.taskId,
      context,
      issueLink,
      "status",
      (changes, write) =>
        updateIssueLabelsGitlab(config, issueIid, changes, true, write),
    );
    if (currentValue === undefined) return;
    const write = createIssueWrite(
      db,
      { ...issueLink, taskId: event.taskId },
      JSON.stringify(context.config),
    );

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

    if (!closing && !reopening) {
      return;
    }

    await write(() =>
      createGitlabClient(config).updateIssue(config.projectPath, issueIid, {
        state_event: closing ? "close" : "reopen",
      }),
    );

    await updateExternalLink(db, issueLink.id, {
      metadata: {
        ...parseLinkSyncMetadata(issueLink.metadata, {
          externalLinkId: issueLink.id,
          field: "state",
        }),
        state: closing ? "closed" : "opened",
        lastOutboundStateSyncAt: Date.now(),
      },
    });
  } catch (error) {
    logger.error(`Failed to update GitLab issue status: ${errorText(error)}`);
  }
}
