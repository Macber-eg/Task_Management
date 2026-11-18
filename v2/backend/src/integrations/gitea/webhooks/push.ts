import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../../events/event-bus";
import { extractTaskNumberFromBranch } from "../../git-shared/branch-matcher";
import { createOrUpdateExternalLink } from "../../links/external-link-writes";
import {
  findLinkedTask,
  withIntegrationTask,
} from "../../links/integration-task-scope";
import {
  findTaskByNumber,
  isTaskInFinalState,
  updateTaskStatus,
} from "../../links/integration-tasks";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import type { GiteaConfig } from "../config";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
} from "../webhook/gitea-webhook-repository";
import { publishStatusChange } from "./publish-status-change";

const logger = new Logger("GiteaPush");

export type PushPayload = {
  after?: string;
  ref: string;
  head_commit?: {
    id: string;
    message: string;
    author?: { name: string };
    timestamp: string;
  };
  commits?: Array<{
    id: string;
    message: string;
    author?: { name: string; username?: string };
    timestamp?: string;
  }>;
  repository: GiteaWebhookRepository;
};

const PROTECTED_BRANCHES = [
  "main",
  "master",
  "develop",
  "staging",
  "production",
];

/**
 * A branch was pushed: links it to the task its name points at and moves the
 * task to the branch-push column (a completed task only for a new branch).
 */
export async function handleGiteaPush(
  db: EntityManager,
  events: EventBus,
  payload: PushPayload,
  integrationId?: string,
): Promise<void> {
  const { ref, repository } = payload;

  if (/^0+$/.test(payload.after ?? "")) {
    return;
  }

  if (!ref.startsWith("refs/heads/")) {
    return;
  }

  const branchName = ref.slice("refs/heads/".length);

  if (PROTECTED_BRANCHES.includes(branchName)) {
    return;
  }

  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  if (integrations.length === 0) {
    return;
  }

  const headCommit =
    payload.head_commit ?? payload.commits?.[payload.commits.length - 1];

  for (const integration of integrations) {
    if (!integration.project) {
      continue;
    }

    let config: GiteaConfig;
    try {
      config = JSON.parse(integration.config) as GiteaConfig;
    } catch {
      logger.error(
        `Invalid Gitea integration config for push webhook (integration ${integration.id})`,
      );
      continue;
    }

    const taskNumber = extractTaskNumberFromBranch(
      branchName,
      config,
      integration.project.slug,
    );

    if (!taskNumber) {
      continue;
    }

    const found = await findTaskByNumber(db, integration.projectId, taskNumber);

    if (!found) {
      continue;
    }

    const treeUrl = `${repository.html_url}/src/branch/${branchName}`;

    const taskId = found.id;
    await withIntegrationTask(db, taskId, integration, async (tx, afterCommit) => {
      const task = await findLinkedTask(tx, taskId, integration.projectId);
      if (!task) return;
      const branchLink = await createOrUpdateExternalLink(tx, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "branch",
        externalId: branchName,
        url: treeUrl,
        title: branchName,
        metadata: {
          lastCommit: headCommit
            ? {
                sha: headCommit.id,
                message: headCommit.message,
                author: headCommit.author?.name,
                timestamp:
                  "timestamp" in headCommit ? headCommit.timestamp : undefined,
              }
            : null,
        },
      });

      const targetStatus = await resolveTargetStatus(
        tx,
        "gitea",
        integration.projectId,
        "branch_push",
        config.statusTransitions?.onBranchPush || "in-progress",
      );

      const canMove =
        branchLink.created || !(await isTaskInFinalState(tx, task));

      if (task.status !== targetStatus && canMove) {
        publishStatusChange(
          events,
          afterCommit,
          await updateTaskStatus(tx, task.id, targetStatus),
        );
      }
      afterCommit(() =>
        events.publish("task.updated", {
          projectId: integration.projectId,
          taskId: task.id,
        }),
      );
    });
  }
}
