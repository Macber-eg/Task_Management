import type { EntityManager } from "typeorm";
import type { EventBus } from "../../../events/event-bus";
import { deferIssueEdit } from "../../links/defer-issue-edit";
import { issueEditScope } from "../../links/deferred-issue-edit";
import { findExternalLink } from "../../links/external-link-queries";
import { updateExternalLink } from "../../links/external-link-writes";
import {
  inboundEcho,
  withEchoConfirmation,
} from "../../links/inbound-echo";
import { findLinkedTask } from "../../links/integration-task-scope";
import { formatTaskDescriptionFromIssue } from "../../links/issue-format";
import { inboundStamp, type SyncStamp } from "../../links/sync-echo";
import { withIntegrationLink } from "../../links/with-integration-link";
import { createGiteaClient } from "../client/gitea-client";
import type { GiteaConfig } from "../config";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
} from "../webhook/gitea-webhook-repository";

export type IssueEditedPayload = {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    updated_at?: string;
    html_url: string;
  };
  changes?: {
    title?: { from: string };
    body?: { from: string };
  };
  repository: GiteaWebhookRepository;
};

type LinkMetadata = Record<string, unknown> & {
  lastSync?: Record<string, SyncStamp | undefined>;
};

/** Copies an edited issue title or body to the linked task, skipping echoes. */
export async function handleGiteaIssueEdited(
  db: EntityManager,
  events: EventBus,
  payload: IssueEditedPayload,
  integrationId?: string,
): Promise<void> {
  const { issue, repository, changes } = payload;

  if (!changes?.title && !changes?.body) {
    return;
  }

  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  for (const integration of integrations) {
    const externalLink = await findExternalLink(
      db,
      integration.id,
      "issue",
      issue.number.toString(),
    );

    if (!externalLink) {
      continue;
    }

    const readCurrent = async () => {
      const config = JSON.parse(integration.config) as GiteaConfig;
      return await createGiteaClient(config).getIssue(
        config.repositoryOwner,
        config.repositoryName,
        issue.number,
      );
    };
    await withEchoConfirmation(
      db,
      readCurrent,
      (current, confirmation) =>
        withIntegrationLink(
          db,
          externalLink,
          integration,
          async (tx, afterCommit, locked) => {
            const task = await findLinkedTask(
              tx,
              locked.taskId,
              integration.projectId,
            );
            if (!task) {
              return;
            }
            const metadata = (
              locked.metadata ? JSON.parse(locked.metadata) : {}
            ) as LinkMetadata;

            const updateData: { title?: string; description?: string } = {};
            const updatedMetadata: LinkMetadata = { ...metadata };
            const lastSync: Record<string, SyncStamp | undefined> =
              updatedMetadata.lastSync ?? {};
            updatedMetadata.lastSync = lastSync;

            if (changes.title) {
              const lastTitleSync = metadata.lastSync?.title;
              const echo =
                !!lastTitleSync &&
                inboundEcho(
                  lastTitleSync,
                  issue.title,
                  issue.updated_at,
                  current?.title,
                  {
                    linkId: locked.id,
                    field: "title",
                    localValue: task.title,
                    confirmation,
                  },
                );
              if (!echo) {
                updateData.title = issue.title;
                lastSync.title = inboundStamp(
                  metadata.lastSync?.title,
                  issue.title,
                  "gitea",
                  issue.updated_at,
                );
              }
            }

            if (changes.body) {
              const lastDescSync = metadata.lastSync?.description;
              const formattedDescription = formatTaskDescriptionFromIssue(
                issue.body,
                locked.taskId,
              );
              const echo =
                !!lastDescSync &&
                inboundEcho(
                  lastDescSync,
                  formattedDescription,
                  issue.updated_at,
                  current
                    ? formatTaskDescriptionFromIssue(
                        current.body ?? null,
                        task.id,
                      )
                    : undefined,
                  {
                    linkId: locked.id,
                    field: "description",
                    localValue: task.description || "",
                    confirmation,
                  },
                );
              if (!echo) {
                updateData.description = formattedDescription;
                lastSync.description = inboundStamp(
                  metadata.lastSync?.description,
                  formattedDescription,
                  "gitea",
                  issue.updated_at,
                );
              }
            }

            if (Object.keys(updateData).length > 0) {
              const set: string[] = [];
              const values: unknown[] = [task.id, integration.projectId];
              for (const [column, value] of Object.entries(updateData)) {
                values.push(value);
                set.push(`${column} = $${values.length}`);
              }
              values.push(new Date());
              set.push(`updated_at = $${values.length}`);
              await tx.query(
                `UPDATE task SET ${set.join(", ")} WHERE id = $1 AND project_id = $2`,
                values,
              );

              await updateExternalLink(tx, locked.id, {
                title: issue.title,
                metadata: updatedMetadata,
              });
              afterCommit(() =>
                events.publish("task.updated", {
                  projectId: integration.projectId,
                  taskId: locked.taskId,
                  ...(typeof updateData.title === "string"
                    ? { titleChanged: true }
                    : {}),
                }),
              );
            }
          },
          {
            validate: (binding) =>
              issueEditScope(binding) === issueEditScope(integration),
          },
        ),
      () =>
        deferIssueEdit(db, externalLink, integration, [
          ...(changes.title ? ["title" as const] : []),
          ...(changes.body ? ["description" as const] : []),
        ]),
    );
  }
}
