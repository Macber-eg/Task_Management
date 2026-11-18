import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import { issueEditScope } from "../../links/deferred-issue-edit";
import { deferIssueEdit } from "../../links/defer-issue-edit";
import { updateExternalLink } from "../../links/external-link-writes";
import { inboundEcho, withEchoConfirmation } from "../../links/inbound-echo";
import { findLinkedTask } from "../../links/integration-task-scope";
import {
  isTaskInFinalState,
  updateTaskStatus,
} from "../../links/integration-tasks";
import { parseLinkMetadata } from "../../links/parse-link-metadata";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { inboundStamp, type SyncStamp } from "../../links/sync-echo";
import { withIntegrationLink } from "../../links/with-integration-link";
import type { GitHubConfig } from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import { findRepositoryIntegrations } from "./find-repository-integrations";

export type IssueStatePayload = {
  action: string;
  issue: {
    number: number;
    title: string;
    html_url: string;
    state: string;
    updated_at?: string;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
    full_name: string;
  };
};

type StateMetadata = Record<string, unknown> & {
  lastSync?: { state?: SyncStamp };
};

const transitions = {
  closed: { event: "issue_closed", fallback: "done", source: "issue_closed" },
  open: { event: "issue_reopened", fallback: "to-do", source: "issue_reopened" },
} as const;

/**
 * `issues.closed` / `issues.reopened`: moves each linked task through the
 * project's workflow rule, unless the change is our own echo or the issue was
 * exported from Kaneo. A delivery that cannot be confirmed in time is deferred.
 */
export async function handleIssueStateChanged(
  deps: GitHubDeps,
  payload: IssueStatePayload,
  state: "closed" | "open",
): Promise<void> {
  const { issue } = payload;
  const transition = transitions[state];

  for (const integration of await findRepositoryIntegrations(deps.db, payload)) {
    const externalLink = await deps.db.findOne(ExternalLinkEntity, {
      where: {
        integrationId: integration.id,
        resourceType: "issue",
        externalId: issue.number.toString(),
      },
    });
    if (!externalLink) continue;

    const readCurrent = async () => {
      const config = JSON.parse(integration.config) as GitHubConfig;
      const octokit = await deps.github.verifiedInstallationOctokit(config);
      return (
        await octokit.rest.issues.get({
          owner: config.repositoryOwner,
          repo: config.repositoryName,
          issue_number: issue.number,
        })
      ).data;
    };
    await withEchoConfirmation(
      deps.db,
      readCurrent,
      (current, confirmation) =>
        withIntegrationLink(
          deps.db,
          externalLink,
          integration,
          async (tx, afterCommit, lockedLink) => {
            const task = await findLinkedTask(
              tx,
              lockedLink.taskId,
              integration.projectId,
            );
            if (!task) return;

            const existingMetadata = parseLinkMetadata<StateMetadata>(
              lockedLink.metadata,
              { externalLinkId: lockedLink.id, source: transition.source },
            );
            if (existingMetadata.createdFrom === "kaneo") return;
            if (state === "open" && existingMetadata.state === "open") return;

            if (
              inboundEcho(
                existingMetadata.lastSync?.state,
                state,
                issue.updated_at,
                current?.state,
                {
                  linkId: lockedLink.id,
                  field: "state",
                  localValue: (await isTaskInFinalState(tx, task))
                    ? "closed"
                    : "open",
                  confirmation,
                },
              )
            )
              return;

            const targetStatus = await resolveTargetStatus(
              tx,
              "github",
              task.projectId,
              transition.event,
              transition.fallback,
            );
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

            await updateExternalLink(tx, lockedLink.id, {
              metadata: {
                ...existingMetadata,
                state,
                lastSync: {
                  ...existingMetadata.lastSync,
                  state: inboundStamp(
                    existingMetadata.lastSync?.state,
                    state,
                    "github",
                    current?.updated_at ?? issue.updated_at,
                  ),
                },
              },
            });
          },
          {
            validate: (binding) =>
              issueEditScope(binding) === issueEditScope(integration),
          },
        ),
      () => deferIssueEdit(deps.db, externalLink, integration, ["state"]),
    );
  }
}
