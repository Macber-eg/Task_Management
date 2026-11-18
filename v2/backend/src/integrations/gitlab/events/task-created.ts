import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../../events/event-bus";
import type { PluginContext, TaskCreatedEvent } from "../../core/task-events";
import { findExternalLinkByTaskAndType } from "../../links/external-link-queries";
import {
  createExternalLink,
  updateExternalLink,
} from "../../links/external-link-writes";
import { formatIssueBody, formatIssueTitle } from "../../links/issue-format";
import { withTaskSyncCreation } from "../../sync/create-task-issue";
import { canSyncTask } from "../../sync/eligibility";
import {
  initializeTaskIssue,
  isIssueInitializationPending,
} from "../../sync/initialize-task-issue";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import { createGitlabClient } from "../client/gitlab-client";
import type { GitlabConfig } from "../config";
import { errorText } from "../../git-shared/error-text";
import { gitlabIssueAccess } from "../gitlab-issue-access";
import { updateIssueLabelsGitlab } from "../labels/issue-labels";

const logger = new Logger("GitlabTaskCreated");

async function createTaskIssue(
  db: EntityManager,
  events: EventBus,
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
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

  if (existingLink && !isIssueInitializationPending(existingLink)) return;

  try {
    const client = createGitlabClient(config);
    if (
      !(await canSyncTask(
        db,
        event.taskId,
        context.integrationId,
        JSON.stringify(context.config),
      ))
    )
      return;

    let createdLink: { id: string; metadata?: string | null } | undefined =
      existingLink ?? undefined;
    let issueNumber = existingLink ? Number(existingLink.externalId) : 0;
    if (!existingLink) {
      const createdIssue = await client.createIssue(config.projectPath, {
        title: formatIssueTitle(event.title),
        description: formatIssueBody(event.description, event.taskId),
      });

      createdLink = await createExternalLink(db, {
        taskId: event.taskId,
        integrationId: context.integrationId,
        resourceType: "issue",
        externalId: createdIssue.iid.toString(),
        url: createdIssue.web_url,
        title: createdIssue.title,
        metadata: {
          state: createdIssue.state,
          createdFrom: "kaneo",
          syncInitializationPending: true,
          syncCreatedText: {
            title: event.title,
            description: event.description ?? "",
          },
          lastOutboundStateSyncAt: Date.now(),
        },
      });
      issueNumber = createdIssue.iid;
    }
    if (!createdLink) return;
    const link = createdLink;

    if (
      !(await canSyncTask(
        db,
        event.taskId,
        context.integrationId,
        JSON.stringify(context.config),
      ))
    ) {
      await updateExternalLink(db, link.id, {
        metadata: { syncFilterPaused: true },
      });
      return;
    }

    const issueLink = { id: link.id, externalId: String(issueNumber) };
    await initializeTaskIssue(db, events, event, context, link, {
      text: async (field, value) =>
        (
          await client.updateIssue(
            config.projectPath,
            issueNumber,
            field === "title"
              ? { title: formatIssueTitle(value) }
              : { description: formatIssueBody(value, event.taskId) },
          )
        )?.updated_at,
      state: async (value) =>
        (
          await client.updateIssue(config.projectPath, issueNumber, {
            state_event: value === "closed" ? "close" : "reopen",
          })
        )?.updated_at,
      labels: () =>
        syncTaskFieldLabels(
          db,
          gitlabIssueAccess(JSON.stringify(context.config), {
            ...issueLink,
            taskId: event.taskId,
          }),
          event.taskId,
          context,
          issueLink,
          "initialization",
          (changes, write) =>
            updateIssueLabelsGitlab(config, issueNumber, changes, true, write),
        ),
    });
  } catch (error) {
    logger.error(`Failed to create GitLab issue: ${errorText(error)}`);
  }
}

/** Exports a task as a GitLab issue (once per task, across instances). */
export async function handleTaskCreated(
  db: EntityManager,
  events: EventBus,
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  await withTaskSyncCreation(db, event, context, (current) =>
    createTaskIssue(db, events, current, context),
  );
}
