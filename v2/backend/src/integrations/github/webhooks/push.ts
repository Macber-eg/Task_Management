import { Logger } from "@nestjs/common";
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
import type { GitHubConfig } from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import { findRepositoryIntegrations } from "./find-repository-integrations";

const logger = new Logger("GitHubPush");

export type PushPayload = {
  after?: string;
  ref: string;
  head_commit?: {
    id: string;
    message: string;
    author?: { name: string };
    timestamp: string;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
    html_url: string;
  };
};

const PROTECTED_BRANCHES = [
  "main",
  "master",
  "develop",
  "staging",
  "production",
];

/**
 * A push to a task branch links the branch to the first bound project's task
 * it names and moves the task (a finished task only on its first branch).
 */
export async function handlePush(
  deps: GitHubDeps,
  payload: PushPayload,
): Promise<void> {
  const { ref, repository, head_commit } = payload;

  if (/^0+$/.test(payload.after ?? "")) return;
  if (!ref.startsWith("refs/heads/")) return;

  const branchName = ref.slice("refs/heads/".length);
  if (PROTECTED_BRANCHES.includes(branchName)) return;

  const integrations = await findRepositoryIntegrations(deps.db, payload);
  if (integrations.length === 0) {
    logger.log(
      `No integrations found for ${repository.owner.login}/${repository.name}`,
    );
    return;
  }

  for (const integration of integrations) {
    const config = JSON.parse(integration.config) as GitHubConfig;
    const taskNumber = extractTaskNumberFromBranch(
      branchName,
      config,
      integration.project.slug,
    );
    if (!taskNumber) continue;

    const found = await findTaskByNumber(
      deps.db,
      integration.projectId,
      taskNumber,
    );
    if (!found) continue;

    const taskId = found.id;
    await withIntegrationTask(
      deps.db,
      taskId,
      integration,
      async (tx, afterCommit) => {
        const task = await findLinkedTask(tx, taskId, integration.projectId);
        if (!task) return;
        const branchLink = await createOrUpdateExternalLink(tx, {
          taskId: task.id,
          integrationId: integration.id,
          resourceType: "branch",
          externalId: branchName,
          url: `${repository.html_url}/tree/${branchName}`,
          title: branchName,
          metadata: {
            lastCommit: head_commit
              ? {
                  sha: head_commit.id,
                  message: head_commit.message,
                  author: head_commit.author?.name,
                  timestamp: head_commit.timestamp,
                }
              : null,
          },
        });

        const targetStatus = await resolveTargetStatus(
          tx,
          "github",
          integration.projectId,
          "branch_push",
          config.statusTransitions?.onBranchPush || "in-progress",
        );
        const canMove =
          branchLink.created || !(await isTaskInFinalState(tx, task));

        if (task.status !== targetStatus && canMove) {
          const statusResult = await updateTaskStatus(
            tx,
            task.id,
            targetStatus,
          );
          if (
            statusResult.applied &&
            statusResult.before.status !== statusResult.after.status
          ) {
            const { before, after } = statusResult;
            afterCommit(() =>
              deps.events.publish("task.status_changed", {
                taskId: after.id,
                projectId: after.projectId,
                userId: null,
                oldStatus: before.status,
                newStatus: after.status,
                title: after.title,
                assigneeId: after.userId,
                type: "status_changed",
              }),
            );
          }
        }

        afterCommit(() =>
          deps.events.publish("task.updated", {
            projectId: integration.projectId,
            taskId: task.id,
          }),
        );
      },
    );

    return;
  }
}
