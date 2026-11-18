import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import type { EventBus } from "../../../events/event-bus";
import { updateExternalLink } from "../../links/external-link-writes";
import { findLinkedTask } from "../../links/integration-task-scope";
import { updateTaskStatus } from "../../links/integration-tasks";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { withIntegrationLink } from "../../links/with-integration-link";
import { isOutboundStateEcho } from "../sync/outbound-echo";
import { findAllIntegrationsByGitlabProject } from "../webhook/find-gitlab-integrations";
import type { GitlabWebhookProject } from "../webhook/payload";
import { baseUrlFromProjectWebUrl } from "../webhook/webhook-project";
import { publishStatusChange } from "./publish-status-change";

const logger = new Logger("GitlabIssueState");

export type IssueStatePayload = {
  object_attributes: {
    iid: number;
    title: string;
    url: string;
    state: string;
    action?: string;
    updated_at?: string;
  };
  project: GitlabWebhookProject;
};

const transitions = {
  close: { state: "closed", event: "issue_closed", fallback: "done" },
  reopen: { state: "opened", event: "issue_reopened", fallback: "to-do" },
} as const;

/** Moves the linked task when its GitLab issue was closed or reopened. */
async function applyIssueState(
  db: EntityManager,
  events: EventBus,
  action: keyof typeof transitions,
  payload: IssueStatePayload,
  integrationId?: string,
) {
  const issue = payload.object_attributes;
  const { project } = payload;
  const transition = transitions[action];

  if (issue.action !== action) {
    return;
  }

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
    const externalLink = await db.findOne(ExternalLinkEntity, {
      where: {
        integrationId: integration.id,
        resourceType: "issue",
        externalId: issue.iid.toString(),
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
        const task = await findLinkedTask(
          tx,
          lockedLink.taskId,
          integration.projectId,
        );

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
              `Failed to parse GitLab issue metadata for ${action} sync (link ${lockedLink.id})`,
            );
          }
        }

        // Only an echo if it reports the state Kaneo last wrote.
        if (isOutboundStateEcho(existingMetadata, transition.state, issue)) {
          return;
        }

        const targetStatus = await resolveTargetStatus(
          tx,
          "gitlab",
          task.projectId,
          transition.event,
          transition.fallback,
        );

        publishStatusChange(
          events,
          afterCommit,
          await updateTaskStatus(tx, task.id, targetStatus),
          integration.id,
        );

        await updateExternalLink(tx, lockedLink.id, {
          metadata: {
            ...existingMetadata,
            state: transition.state,
          },
        });
      },
    );
  }
}

export function handleGitlabIssueClosed(
  db: EntityManager,
  events: EventBus,
  payload: IssueStatePayload,
  integrationId?: string,
) {
  return applyIssueState(db, events, "close", payload, integrationId);
}

export function handleGitlabIssueReopened(
  db: EntityManager,
  events: EventBus,
  payload: IssueStatePayload,
  integrationId?: string,
) {
  return applyIssueState(db, events, "reopen", payload, integrationId);
}
