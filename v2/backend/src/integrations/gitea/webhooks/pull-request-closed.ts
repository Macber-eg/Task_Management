import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import type { EventBus } from "../../../events/event-bus";
import { updateExternalLink } from "../../links/external-link-writes";
import {
  findTaskById,
  updateTaskStatus,
} from "../../links/integration-tasks";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { withIntegrationLink } from "../../links/with-integration-link";
import type { GiteaConfig } from "../config";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
} from "../webhook/gitea-webhook-repository";
import { publishStatusChange } from "./publish-status-change";

export type PullRequestClosedPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    state: string;
    merged: boolean;
    merged_at: string | null;
    head: {
      ref: string;
    };
  };
  repository: GiteaWebhookRepository;
};

/**
 * A pull request was closed: records it on its link and, when merged and no
 * other pull request of the task is open, moves the task to the merge column.
 */
export async function handleGiteaPullRequestClosed(
  db: EntityManager,
  events: EventBus,
  payload: PullRequestClosedPayload,
  integrationId?: string,
): Promise<void> {
  const { pull_request, repository } = payload;

  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  for (const integration of integrations) {
    const config = JSON.parse(integration.config) as GiteaConfig;

    const externalLink = await db.findOne(ExternalLinkEntity, {
      where: {
        integrationId: integration.id,
        resourceType: "pull_request",
        externalId: pull_request.number.toString(),
      },
    });

    if (!externalLink) {
      continue;
    }

    await withIntegrationLink(
      db,
      externalLink,
      integration,
      async (tx, afterCommit, lockedLink) => {
        const task = await findTaskById(tx, externalLink.taskId);

        if (!task) {
          return;
        }

        const existingMetadata = lockedLink.metadata
          ? (JSON.parse(lockedLink.metadata) as Record<string, unknown>)
          : {};

        await updateExternalLink(tx, externalLink.id, {
          metadata: {
            ...existingMetadata,
            state: "closed",
            merged: pull_request.merged,
            mergedAt: pull_request.merged_at,
          },
        });

        afterCommit(() =>
          events.publish("task.updated", {
            projectId: integration.projectId,
            taskId: task.id,
          }),
        );

        if (pull_request.merged) {
          const allTaskPRs = await tx.find(ExternalLinkEntity, {
            where: { taskId: task.id, resourceType: "pull_request" },
          });

          const hasOpenPRs = allTaskPRs.some((pr) => {
            if (pr.id === externalLink.id) return false;
            const metadata = pr.metadata ? JSON.parse(pr.metadata) : {};
            return metadata.state === "open";
          });

          if (!hasOpenPRs) {
            const targetStatus = await resolveTargetStatus(
              tx,
              "gitea",
              integration.projectId,
              "pr_merged",
              config.statusTransitions?.onPRMerge || "done",
            );
            publishStatusChange(
              events,
              afterCommit,
              await updateTaskStatus(tx, task.id, targetStatus),
            );
          }
        }
      },
    );

    return;
  }
}
