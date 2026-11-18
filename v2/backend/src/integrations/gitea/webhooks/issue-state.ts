import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import type { EventBus } from "../../../events/event-bus";
import { errorText } from "../../git-shared/error-text";
import { deferIssueEdit } from "../../links/defer-issue-edit";
import { issueEditScope } from "../../links/deferred-issue-edit";
import { updateExternalLink } from "../../links/external-link-writes";
import {
  inboundEcho,
  PendingResponseTimeout,
  withEchoConfirmation,
} from "../../links/inbound-echo";
import { findLinkedTask } from "../../links/integration-task-scope";
import {
  isTaskInFinalState,
  updateTaskStatus,
} from "../../links/integration-tasks";
import { parseLinkMetadata } from "../../links/parse-link-metadata";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { inboundStamp, type SyncStamp } from "../../links/sync-echo";
import { withIntegrationLink } from "../../links/with-integration-link";
import { createGiteaClient } from "../client/gitea-client";
import type { GiteaConfig } from "../config";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
  repoOwnerLogin,
} from "../webhook/gitea-webhook-repository";
import { publishStatusChange } from "./publish-status-change";

/** Skip webhook sync when it likely echoes our own outbound API update. */
const OUTBOUND_STATE_ECHO_WINDOW_MS = 5000;

const logger = new Logger("GiteaIssueState");

export type IssueStatePayload = {
  action: string;
  issue: {
    number: number;
    title: string;
    html_url: string;
    state: string;
    updated_at?: string;
  };
  repository: GiteaWebhookRepository;
};

function parseIssueUpdatedAtMs(issue: { updated_at?: string }): number | null {
  const raw = issue.updated_at;
  if (!raw || typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

const transitions = {
  closed: { action: "closed", eventType: "issue_closed", fallback: "done" },
  open: { action: "reopened", eventType: "issue_reopened", fallback: "to-do" },
} as const;

/**
 * An issue was closed or reopened in Gitea: moves the linked task through the
 * project's workflow rule unless the delivery echoes Kaneo's own write.
 * Deliveries that cannot be confirmed in time are deferred to the replay job.
 */
export async function handleGiteaIssueState(
  db: EntityManager,
  events: EventBus,
  payload: IssueStatePayload,
  state: "closed" | "open",
  integrationId?: string,
): Promise<void> {
  const transition = transitions[state];
  if (payload.action !== transition.action) {
    return;
  }

  const { issue, repository } = payload;
  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  for (const integration of integrations) {
    const apply = async () => {
      const externalLink = await db.findOne(ExternalLinkEntity, {
        where: {
          integrationId: integration.id,
          resourceType: "issue",
          externalId: issue.number.toString(),
        },
      });

      if (!externalLink) {
        return;
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

              const existingMetadata = parseLinkMetadata<
                Record<string, unknown> & { lastSync?: { state?: SyncStamp } }
              >(locked.metadata, {
                externalLinkId: locked.id,
                source:
                  state === "closed"
                    ? "gitea_issue_closed"
                    : "gitea_issue_reopened",
              });
              if (
                inboundEcho(
                  existingMetadata.lastSync?.state,
                  state,
                  issue.updated_at,
                  current ? (current.state ?? issue.state) : undefined,
                  {
                    linkId: locked.id,
                    field: "state",
                    localValue: (await isTaskInFinalState(tx, task))
                      ? "closed"
                      : "open",
                    confirmation,
                  },
                )
              )
                return;
              const lastOutbound = existingMetadata.lastOutboundStateSyncAt;
              if (
                typeof lastOutbound === "number" &&
                Number.isFinite(lastOutbound) &&
                existingMetadata.state === state
              ) {
                const eventMs = parseIssueUpdatedAtMs(issue);
                if (
                  eventMs !== null &&
                  Math.abs(eventMs - lastOutbound) <=
                    OUTBOUND_STATE_ECHO_WINDOW_MS
                ) {
                  return;
                }
              }

              const targetStatus = await resolveTargetStatus(
                tx,
                "gitea",
                task.projectId,
                transition.eventType,
                transition.fallback,
              );

              publishStatusChange(
                events,
                afterCommit,
                await updateTaskStatus(tx, task.id, targetStatus),
              );

              await updateExternalLink(tx, locked.id, {
                metadata: {
                  ...existingMetadata,
                  state,
                  lastSync: {
                    ...existingMetadata.lastSync,
                    state: inboundStamp(
                      existingMetadata.lastSync?.state,
                      state,
                      "gitea",
                      current?.updated_at ?? issue.updated_at,
                    ),
                  },
                },
              });
            },
            {
              validate: (binding) =>
                issueEditScope(binding) === issueEditScope(integration),
            },
          ),
        () => deferIssueEdit(db, externalLink, integration, ["state"]),
      );
    };

    // The previous handler isolated each integration only for reopen events.
    if (state === "closed") {
      await apply();
      continue;
    }
    try {
      await apply();
    } catch (error) {
      if (error instanceof PendingResponseTimeout) throw error;
      logger.error(
        `Gitea issue_reopened handler failed for integration ${integration.id} (issue #${issue.number}, ${repoOwnerLogin(repository)}/${repository.name}): ${errorText(error)}`,
      );
    }
  }
}
