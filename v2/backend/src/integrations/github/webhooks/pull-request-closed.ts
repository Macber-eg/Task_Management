import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import { updateExternalLink } from "../../links/external-link-writes";
import { findTaskById, updateTaskStatus } from "../../links/integration-tasks";
import { parseLinkMetadata } from "../../links/parse-link-metadata";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { withIntegrationLink } from "../../links/with-integration-link";
import type { GitHubConfig } from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import { findRepositoryIntegrations } from "./find-repository-integrations";

export type PullRequestClosedPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    state: string;
    merged: boolean;
    merged_at: string | null;
    head: { ref: string };
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

/**
 * Records the closed (or merged) pull request on its link; a merge with no
 * other open pull request of the task moves the task. Only the first bound
 * integration holding the link is updated.
 */
export async function handlePullRequestClosed(
  deps: GitHubDeps,
  payload: PullRequestClosedPayload,
): Promise<void> {
  const { pull_request } = payload;

  for (const integration of await findRepositoryIntegrations(deps.db, payload)) {
    const config = JSON.parse(integration.config) as GitHubConfig;

    const externalLink = await deps.db.findOne(ExternalLinkEntity, {
      where: {
        integrationId: integration.id,
        resourceType: "pull_request",
        externalId: pull_request.number.toString(),
      },
    });
    if (!externalLink) continue;

    await withIntegrationLink(
      deps.db,
      externalLink,
      integration,
      async (tx, afterCommit, lockedLink) => {
        const task = await findTaskById(tx, externalLink.taskId);
        if (!task) return;

        const existingMetadata = parseLinkMetadata(lockedLink.metadata, {
          externalLinkId: externalLink.id,
          source: "pull_request_closed",
        });

        await updateExternalLink(tx, externalLink.id, {
          metadata: {
            ...existingMetadata,
            state: "closed",
            merged: pull_request.merged,
            mergedAt: pull_request.merged_at,
          },
        });

        afterCommit(() =>
          deps.events.publish("task.updated", {
            projectId: integration.projectId,
            taskId: task.id,
          }),
        );

        if (!pull_request.merged) return;

        const allTaskPRs = await tx.find(ExternalLinkEntity, {
          where: { taskId: task.id, resourceType: "pull_request" },
        });
        const hasOpenPRs = allTaskPRs.some((pr) => {
          if (pr.id === externalLink.id) return false;
          const metadata = parseLinkMetadata(pr.metadata, {
            externalLinkId: pr.id,
            source: "pull_request_closed",
          });
          return metadata.state === "open";
        });
        if (hasOpenPRs) return;

        const targetStatus = await resolveTargetStatus(
          tx,
          "github",
          integration.projectId,
          "pr_merged",
          config.statusTransitions?.onPRMerge || "done",
        );
        const statusResult = await updateTaskStatus(tx, task.id, targetStatus);
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

    return;
  }
}
