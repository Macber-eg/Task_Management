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
import type { GitlabConfig } from "../config";
import { findAllIntegrationsByGitlabProject } from "../webhook/find-gitlab-integrations";
import type { GitlabWebhookProject } from "../webhook/payload";
import { baseUrlFromProjectWebUrl } from "../webhook/webhook-project";
import { publishStatusChange } from "./publish-status-change";

const logger = new Logger("GitlabPush");

export type PushPayload = {
  after?: string;
  ref: string;
  commits?: Array<{
    id: string;
    message: string;
    timestamp?: string;
    author?: { name?: string };
  }>;
  project: GitlabWebhookProject;
};

const PROTECTED_BRANCHES = [
  "main",
  "master",
  "develop",
  "staging",
  "production",
];

// Slashes in a branch name are path separators in the tree URL.
function treePath(branchName: string): string {
  return branchName.split("/").map(encodeURIComponent).join("/");
}

/** Links a pushed branch to the task it names and moves the task to in-progress. */
export async function handleGitlabPush(
  db: EntityManager,
  events: EventBus,
  payload: PushPayload,
  integrationId?: string,
) {
  const { ref, project } = payload;

  if (/^0+$/.test(payload.after ?? "")) {
    return;
  }

  if (!ref.startsWith("refs/heads/")) {
    logger.log(`Skipping non-branch ref: ${ref}`);
    return;
  }

  const branchName = ref.slice("refs/heads/".length);
  logger.log(`Processing branch: ${branchName}`);

  if (PROTECTED_BRANCHES.includes(branchName)) {
    logger.log(`Skipping protected branch: ${branchName}`);
    return;
  }

  const baseUrl = baseUrlFromProjectWebUrl(
    project.web_url,
    project.path_with_namespace,
  );
  if (!baseUrl) {
    return;
  }

  const integrations = await findAllIntegrationsByGitlabProject(
    db,
    baseUrl,
    project.path_with_namespace,
    integrationId,
  );

  if (integrations.length === 0) {
    return;
  }

  const headCommit = payload.commits?.[payload.commits.length - 1];

  for (const integration of integrations) {
    let config: GitlabConfig;
    try {
      config = JSON.parse(integration.config) as GitlabConfig;
    } catch {
      logger.error(
        `Invalid GitLab integration config for push webhook (integration ${integration.id})`,
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

    const taskId = found.id;
    await withIntegrationTask(
      db,
      taskId,
      integration,
      async (database, afterCommit) => {
        const task = await findLinkedTask(
          database,
          taskId,
          integration.projectId,
        );
        if (!task) return;
        const branchLink = await createOrUpdateExternalLink(database, {
          taskId: task.id,
          integrationId: integration.id,
          resourceType: "branch",
          externalId: branchName,
          url: `${project.web_url}/-/tree/${treePath(branchName)}`,
          title: branchName,
          metadata: {
            lastCommit: headCommit
              ? {
                  sha: headCommit.id,
                  message: headCommit.message,
                  author: headCommit.author?.name,
                  timestamp: headCommit.timestamp,
                }
              : null,
          },
        });

        const targetStatus = await resolveTargetStatus(
          database,
          "gitlab",
          integration.projectId,
          "branch_push",
          config.statusTransitions?.onBranchPush || "in-progress",
        );

        const canMove =
          branchLink.created || !(await isTaskInFinalState(database, task));

        if (task.status !== targetStatus && canMove) {
          publishStatusChange(
            events,
            afterCommit,
            await updateTaskStatus(database, task.id, targetStatus),
          );
        }
        afterCommit(() =>
          events.publish("task.updated", {
            projectId: integration.projectId,
            taskId: task.id,
          }),
        );
      },
    );
  }
}
