import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../../events/event-bus";
import { findExternalLink } from "../../links/external-link-queries";
import {
  createExternalLink,
  updateExternalLink,
} from "../../links/external-link-writes";
import {
  type AfterCommit,
  withIntegrationTask,
} from "../../links/integration-task-scope";
import {
  findTaskById,
  isTaskInFinalState,
  updateTaskStatus,
} from "../../links/integration-tasks";
import { parseLinkMetadata } from "../../links/parse-link-metadata";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { withIntegrationLink } from "../../links/with-integration-link";
import type { GitlabConfig } from "../config";
import { findAllIntegrationsByGitlabProject } from "../webhook/find-gitlab-integrations";
import type {
  GitlabWebhookProject,
  GitlabWebhookUser,
} from "../webhook/payload";
import { resolveMergeRequestTask } from "../webhook/resolve-merge-request-task";
import { baseUrlFromProjectWebUrl } from "../webhook/webhook-project";
import { publishStatusChange } from "./publish-status-change";

const logger = new Logger("GitlabMergeRequestOpened");

export type MergeRequestOpenedPayload = {
  user?: GitlabWebhookUser | null;
  object_attributes: {
    iid: number;
    title: string;
    description: string | null;
    url: string;
    state: string;
    action?: string;
    draft?: boolean;
    source_branch?: string;
  };
  project: GitlabWebhookProject;
};

/**
 * Links an opened (or reopened, or ready) merge request to the task it names
 * and, unless `moveTask` is false, moves the task to the review column.
 */
export async function handleGitlabMergeRequestOpened(
  db: EntityManager,
  events: EventBus,
  payload: MergeRequestOpenedPayload,
  integrationId?: string,
  { moveTask = true }: { moveTask?: boolean } = {},
) {
  const mergeRequest = payload.object_attributes;
  const { project } = payload;
  const branchName = mergeRequest.source_branch;

  if (!branchName) {
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
    let config: GitlabConfig;
    try {
      config = JSON.parse(integration.config) as GitlabConfig;
    } catch {
      logger.error(`Invalid GitLab config for integration ${integration.id}`);
      continue;
    }

    const existingLink = await findExternalLink(
      db,
      integration.id,
      "pull_request",
      mergeRequest.iid.toString(),
    );

    const linkedTask =
      existingLink && (await findTaskById(db, existingLink.taskId));
    if (existingLink && linkedTask?.projectId !== integration.projectId) {
      continue;
    }

    const resolveTask = (database: EntityManager) =>
      resolveMergeRequestTask(database, {
        projectId: integration.projectId,
        projectSlug: integration.project.slug,
        config,
        mergeRequest: { ...mergeRequest, source_branch: branchName },
      });

    const task = linkedTask || (await resolveTask(db));

    if (!task) {
      continue;
    }

    const apply = async (
      database: EntityManager,
      afterCommit: AfterCommit,
      lockedLink?: { metadata: string | null },
    ) => {
      const currentTask = await findTaskById(database, task.id);
      if (!currentTask) return;
      if (!existingLink) {
        if (
          await findExternalLink(
            database,
            integration.id,
            "pull_request",
            mergeRequest.iid.toString(),
          )
        )
          return;
        const resolved = await resolveTask(database);
        if (resolved?.id !== task.id) return;
      }
      const metadata = {
        state: mergeRequest.state,
        draft: mergeRequest.draft === true,
        merged: false,
        branch: branchName,
        author: payload.user?.username ?? payload.user?.name,
      };

      if (existingLink) {
        await updateExternalLink(database, existingLink.id, {
          title: mergeRequest.title,
          url: mergeRequest.url,
          metadata,
        });
      } else {
        await createExternalLink(database, {
          taskId: task.id,
          integrationId: integration.id,
          resourceType: "pull_request",
          externalId: mergeRequest.iid.toString(),
          url: mergeRequest.url,
          title: mergeRequest.title,
          metadata,
        });
      }

      afterCommit(() =>
        events.publish("task.updated", {
          projectId: integration.projectId,
          taskId: task.id,
        }),
      );

      if (!moveTask) {
        return;
      }

      // On reopen the link already exists, but the task still has to move.
      const targetStatus = await resolveTargetStatus(
        database,
        "gitlab",
        integration.projectId,
        "pr_opened",
        config.statusTransitions?.onPROpen || "in-review",
      );

      const wasDraft =
        parseLinkMetadata<{ draft: boolean }>(lockedLink?.metadata, {
          externalLinkId: existingLink?.id ?? "",
          source: "gitlab-merge-request-opened",
        }).draft === true;
      const canMove =
        !existingLink ||
        wasDraft ||
        !(await isTaskInFinalState(database, currentTask));

      if (currentTask.status !== targetStatus && canMove) {
        publishStatusChange(
          events,
          afterCommit,
          await updateTaskStatus(database, task.id, targetStatus),
        );
      }
    };
    if (existingLink)
      await withIntegrationLink(db, existingLink, integration, apply);
    else await withIntegrationTask(db, task.id, integration, apply);

    return;
  }
}
