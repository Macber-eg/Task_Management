import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import type { EventBus } from "../../../events/event-bus";
import { updateExternalLink } from "../../links/external-link-writes";
import { findTaskById, updateTaskStatus } from "../../links/integration-tasks";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { withIntegrationLink } from "../../links/with-integration-link";
import type { GitlabConfig } from "../config";
import { findAllIntegrationsByGitlabProject } from "../webhook/find-gitlab-integrations";
import type { GitlabWebhookProject } from "../webhook/payload";
import { baseUrlFromProjectWebUrl } from "../webhook/webhook-project";
import { publishStatusChange } from "./publish-status-change";

const logger = new Logger("GitlabMergeRequestClosed");

export type MergeRequestClosedPayload = {
  object_attributes: {
    iid: number;
    title: string;
    url: string;
    state: string;
    action?: string;
    source_branch?: string;
  };
  project: GitlabWebhookProject;
};

/**
 * Records a merged or closed merge request on its link; a merge moves the
 * task to the merged column once no other merge request of it is open.
 */
export async function handleGitlabMergeRequestClosed(
  db: EntityManager,
  events: EventBus,
  payload: MergeRequestClosedPayload,
  integrationId?: string,
) {
  const mergeRequest = payload.object_attributes;
  const { project } = payload;
  const merged = mergeRequest.action === "merge";

  const baseUrl = baseUrlFromProjectWebUrl(
    project.web_url,
    project.path_with_namespace,
  );
  if (!baseUrl) return;

  const integrations = await findAllIntegrationsByGitlabProject(
    db,
    baseUrl,
    project.path_with_namespace,
    integrationId,
  );

  for (const integration of integrations) {
    let config: GitlabConfig;
    try {
      config = JSON.parse(integration.config) as GitlabConfig;
    } catch {
      logger.error(`Invalid GitLab config for integration ${integration.id}`);
      continue;
    }

    const externalLink = await db.findOne(ExternalLinkEntity, {
      where: {
        integrationId: integration.id,
        resourceType: "pull_request",
        externalId: mergeRequest.iid.toString(),
      },
    });

    if (!externalLink) {
      continue;
    }

    await withIntegrationLink(
      db,
      externalLink,
      integration,
      async (database, afterCommit, lockedLink) => {
        const task = await findTaskById(database, externalLink.taskId);

        if (!task) {
          return;
        }

        let existingMetadata: Record<string, unknown> = {};
        if (lockedLink.metadata) {
          try {
            existingMetadata = JSON.parse(lockedLink.metadata) as Record<
              string,
              unknown
            >;
          } catch {
            logger.warn(
              `Failed to parse GitLab merge request metadata (link ${externalLink.id})`,
            );
          }
        }

        await updateExternalLink(database, externalLink.id, {
          metadata: {
            ...existingMetadata,
            state: merged ? "merged" : "closed",
            draft: false,
            merged,
          },
        });

        afterCommit(() =>
          events.publish("task.updated", {
            projectId: integration.projectId,
            taskId: task.id,
          }),
        );

        if (!merged) {
          return;
        }

        const allTaskMergeRequests = await database.find(ExternalLinkEntity, {
          where: { taskId: task.id, resourceType: "pull_request" },
        });

        const hasOpenMergeRequests = allTaskMergeRequests.some((link) => {
          if (link.id === externalLink.id) return false;
          try {
            const metadata = link.metadata
              ? (JSON.parse(link.metadata) as { state?: string })
              : {};
            return metadata.state === "opened";
          } catch {
            return false;
          }
        });

        if (hasOpenMergeRequests) {
          return;
        }

        const targetStatus = await resolveTargetStatus(
          database,
          "gitlab",
          integration.projectId,
          "pr_merged",
          config.statusTransitions?.onPRMerge || "done",
        );

        publishStatusChange(
          events,
          afterCommit,
          await updateTaskStatus(database, task.id, targetStatus),
        );
      },
    );

    return;
  }
}
