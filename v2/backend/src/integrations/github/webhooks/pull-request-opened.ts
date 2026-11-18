import { resolvePullRequestTask } from "../../git-shared/resolve-pull-request-task";
import { findExternalLink } from "../../links/external-link-queries";
import { createExternalLink } from "../../links/external-link-writes";
import { withIntegrationTask } from "../../links/integration-task-scope";
import { updateTaskStatus } from "../../links/integration-tasks";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import type { GitHubConfig } from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import {
  findRepositoryIntegrations,
  type RepositoryIntegration,
} from "./find-repository-integrations";

export type PullRequestOpenedPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    draft: boolean;
    merged: boolean;
    head: { ref: string };
    user: { login: string } | null;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

/**
 * `pull_request.opened` / `reopened`: links the pull request to the one task
 * it resolves to (across all bound projects) and moves that task.
 */
export async function handlePullRequestOpened(
  deps: GitHubDeps,
  payload: PullRequestOpenedPayload,
): Promise<void> {
  const { pull_request, repository } = payload;
  const repositoryUrl = `https://github.com/${repository.owner.login}/${repository.name}`;

  const candidates: Array<{
    integration: RepositoryIntegration;
    config: GitHubConfig;
    taskId: string;
  }> = [];
  for (const integration of await findRepositoryIntegrations(deps.db, payload)) {
    const config = JSON.parse(integration.config) as GitHubConfig;
    const existingLink = await findExternalLink(
      deps.db,
      integration.id,
      "pull_request",
      pull_request.number.toString(),
    );
    if (existingLink) return;

    const task = await resolvePullRequestTask(deps.db, {
      integrationId: integration.id,
      projectId: integration.projectId,
      projectSlug: integration.project.slug,
      config,
      repositoryUrl,
      pullRequest: pull_request,
    });
    if (task) candidates.push({ integration, config, taskId: task.id });
  }

  const candidate = candidates[0];
  if (candidates.length !== 1 || !candidate) return;
  const { integration, config, taskId } = candidate;

  await withIntegrationTask(
    deps.db,
    taskId,
    integration,
    async (tx, afterCommit) => {
      const currentTask = await resolvePullRequestTask(tx, {
        integrationId: integration.id,
        projectId: integration.projectId,
        projectSlug: integration.project.slug,
        config,
        repositoryUrl,
        pullRequest: pull_request,
      });
      if (!currentTask || currentTask.id !== taskId) return;
      if (
        await findExternalLink(
          tx,
          integration.id,
          "pull_request",
          pull_request.number.toString(),
        )
      )
        return;
      await createExternalLink(tx, {
        taskId,
        integrationId: integration.id,
        resourceType: "pull_request",
        externalId: pull_request.number.toString(),
        url: pull_request.html_url,
        title: pull_request.title,
        metadata: {
          state: pull_request.state,
          draft: pull_request.draft,
          merged: pull_request.merged,
          branch: pull_request.head.ref,
          author: pull_request.user?.login,
        },
      });

      afterCommit(() =>
        deps.events.publish("task.updated", {
          projectId: integration.projectId,
          taskId,
        }),
      );

      const targetStatus = await resolveTargetStatus(
        tx,
        "github",
        integration.projectId,
        "pr_opened",
        config.statusTransitions?.onPROpen || "in-review",
      );
      if (currentTask.status === targetStatus) return;
      const statusResult = await updateTaskStatus(tx, taskId, targetStatus);
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
    },
  );
}
