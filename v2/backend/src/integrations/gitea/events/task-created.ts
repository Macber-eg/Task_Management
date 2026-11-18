import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../../events/event-bus";
import type { PluginContext, TaskCreatedEvent } from "../../core/task-events";
import { errorText } from "../../git-shared/error-text";
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
import { createGiteaClient } from "../client/gitea-client";
import type { GiteaConfig } from "../config";
import { giteaIssueAccess } from "../gitea-issue-access";
import {
  addLabelsToIssueGitea,
  removeLabelGitea,
} from "../labels/gitea-issue-labels";

const logger = new Logger("GiteaTaskCreated");

async function createTaskIssue(
  db: EntityManager,
  events: EventBus,
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
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

  if (existingLink && !isIssueInitializationPending(existingLink)) return;

  try {
    const client = createGiteaClient(config);
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
      const createdIssue = await client.createIssue(
        repositoryOwner,
        repositoryName,
        {
          title: formatIssueTitle(event.title),
          body: formatIssueBody(event.description, event.taskId),
        },
      );

      createdLink = await createExternalLink(db, {
        taskId: event.taskId,
        integrationId: context.integrationId,
        resourceType: "issue",
        externalId: createdIssue.number.toString(),
        url: createdIssue.html_url,
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
      issueNumber = createdIssue.number;
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
            repositoryOwner,
            repositoryName,
            issueNumber,
            field === "title"
              ? { title: formatIssueTitle(value) }
              : { body: formatIssueBody(value, event.taskId) },
          )
        )?.updated_at,
      state: async (value) =>
        (
          await client.updateIssue(
            repositoryOwner,
            repositoryName,
            issueNumber,
            { state: value === "closed" ? "closed" : "open" },
          )
        )?.updated_at,
      labels: () =>
        syncTaskFieldLabels(
          db,
          giteaIssueAccess(JSON.stringify(context.config), {
            ...issueLink,
            taskId: event.taskId,
          }),
          event.taskId,
          context,
          issueLink,
          "initialization",
          async ({ add, remove }, write) => {
            for (const name of remove)
              await removeLabelGitea(config, issueNumber, name, write, true);
            await addLabelsToIssueGitea(config, issueNumber, add, true, write);
          },
        ),
    });
  } catch (error) {
    logger.error(`Failed to create Gitea issue: ${errorText(error)}`);
  }
}

/** Exports a task as a Gitea issue (once per task, across instances). */
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
