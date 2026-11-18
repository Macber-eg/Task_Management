import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { IntegrationEntity } from "../../../database/entities/integration.entity";
import type { TaskEntity } from "../../../database/entities/task.entity";
import type { EventBus } from "../../../events/event-bus";
import { resolvePullRequestTask } from "../../git-shared/resolve-pull-request-task";
import { findExternalLink } from "../../links/external-link-queries";
import { createExternalLink } from "../../links/external-link-writes";
import { withIntegrationTask } from "../../links/integration-task-scope";
import { updateTaskStatus } from "../../links/integration-tasks";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import type { GiteaConfig } from "../config";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
} from "../webhook/gitea-webhook-repository";
import { publishStatusChange } from "./publish-status-change";

const logger = new Logger("GiteaPullRequestOpened");

export type PullRequestOpenedPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    draft?: boolean;
    merged?: boolean;
    head: {
      ref: string;
    };
    user: { login?: string; username?: string } | null;
  };
  repository: GiteaWebhookRepository;
};

type Candidate = {
  integration: IntegrationEntity & { project: { slug: string } };
  config: GiteaConfig;
  task: TaskEntity;
};

/**
 * A pull request was opened, reopened or marked ready: links it to the one
 * task it names and moves that task to the PR-open column.
 */
export async function handleGiteaPullRequestOpened(
  db: EntityManager,
  events: EventBus,
  payload: PullRequestOpenedPayload,
  integrationId?: string,
): Promise<void> {
  const { pull_request, repository } = payload;

  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  const candidates: Candidate[] = [];
  for (const integration of integrations) {
    const project = integration.project;
    if (!project) {
      continue;
    }

    let config: GiteaConfig;
    try {
      config = JSON.parse(integration.config) as GiteaConfig;
    } catch {
      logger.error(`Invalid Gitea config for integration ${integration.id}`);
      continue;
    }
    const existingLink = await findExternalLink(
      db,
      integration.id,
      "pull_request",
      pull_request.number.toString(),
    );
    if (existingLink) return;

    const task = await resolvePullRequestTask(db, {
      integrationId: integration.id,
      projectId: integration.projectId,
      projectSlug: project.slug,
      config,
      repositoryUrl: repository.html_url,
      pullRequest: pull_request,
    });
    if (task)
      candidates.push({
        integration: integration as Candidate["integration"],
        config,
        task,
      });
  }

  const candidate = candidates[0];
  if (candidates.length !== 1 || !candidate) return;
  const { integration, config, task } = candidate;
  if (integrationId && integration.id !== integrationId) return;
  const branchName = pull_request.head.ref;

  await withIntegrationTask(db, task.id, integration, async (tx, afterCommit) => {
    const currentTask = await resolvePullRequestTask(tx, {
      integrationId: integration.id,
      projectId: integration.projectId,
      projectSlug: integration.project.slug,
      config,
      repositoryUrl: repository.html_url,
      pullRequest: pull_request,
    });
    if (currentTask?.id !== task.id) return;
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
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "pull_request",
      externalId: pull_request.number.toString(),
      url: pull_request.html_url,
      title: pull_request.title,
      metadata: {
        state: pull_request.state,
        draft: pull_request.draft,
        merged: pull_request.merged,
        branch: branchName,
        author: pull_request.user?.login ?? pull_request.user?.username,
      },
    });

    afterCommit(() =>
      events.publish("task.updated", {
        projectId: integration.projectId,
        taskId: task.id,
      }),
    );

    const targetStatus = await resolveTargetStatus(
      tx,
      "gitea",
      integration.projectId,
      "pr_opened",
      config.statusTransitions?.onPROpen || "in-review",
    );

    if (currentTask.status !== targetStatus) {
      publishStatusChange(
        events,
        afterCommit,
        await updateTaskStatus(tx, task.id, targetStatus),
      );
    }
  });
}
