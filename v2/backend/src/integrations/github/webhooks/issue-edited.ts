import { Logger } from "@nestjs/common";
import { issueEditScope } from "../../links/deferred-issue-edit";
import { deferIssueEdit } from "../../links/defer-issue-edit";
import { findExternalLink } from "../../links/external-link-queries";
import { updateExternalLink } from "../../links/external-link-writes";
import { inboundEcho, withEchoConfirmation } from "../../links/inbound-echo";
import { findLinkedTask } from "../../links/integration-task-scope";
import { formatTaskDescriptionFromIssue } from "../../links/issue-format";
import { parseLinkMetadata } from "../../links/parse-link-metadata";
import { inboundStamp, type SyncStamp } from "../../links/sync-echo";
import { withIntegrationLink } from "../../links/with-integration-link";
import type { GitHubConfig } from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import { findRepositoryIntegrations } from "./find-repository-integrations";

const logger = new Logger("GitHubIssueEdited");

// What this handler reads back out of the row. Every field is optional,
// because the row may predate any of them.
type IssueEditedMetadata = {
  lastSync?: {
    title?: SyncStamp;
    description?: SyncStamp;
  };
};

export type IssueEditedPayload = {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    updated_at?: string;
    html_url: string;
  };
  changes?: {
    title?: { from: string };
    body?: { from: string };
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
    full_name: string;
  };
};

/** Copies an edited issue title or body onto each linked task, skipping our own echoes. */
export async function handleIssueEdited(
  deps: GitHubDeps,
  payload: IssueEditedPayload,
): Promise<void> {
  const { issue, changes } = payload;

  if (!changes?.title && !changes?.body) {
    logger.log(
      `Issue #${issue.number} edited but no title/body changes detected`,
    );
    return;
  }

  for (const integration of await findRepositoryIntegrations(deps.db, payload)) {
    const externalLink = await findExternalLink(
      deps.db,
      integration.id,
      "issue",
      issue.number.toString(),
    );
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
            if (!task) {
              logger.error(`Task ${lockedLink.taskId} not found`);
              return;
            }
            const metadata = parseLinkMetadata<IssueEditedMetadata>(
              lockedLink.metadata,
              { externalLinkId: lockedLink.id, source: "issue_edited" },
            );

            const updateData: { title?: string; description?: string } = {};
            const updatedMetadata: IssueEditedMetadata = { ...metadata };
            const lastSync = (updatedMetadata.lastSync ??= {});

            if (changes.title) {
              const lastTitleSync = metadata.lastSync?.title;
              const echo =
                !!lastTitleSync &&
                inboundEcho(
                  lastTitleSync,
                  issue.title,
                  issue.updated_at,
                  current?.title,
                  {
                    linkId: lockedLink.id,
                    field: "title",
                    localValue: task.title,
                    confirmation,
                  },
                );
              if (!echo) {
                updateData.title = issue.title;
                lastSync.title = inboundStamp(
                  metadata.lastSync?.title,
                  issue.title,
                  "github",
                  issue.updated_at,
                );
              }
            }

            if (changes.body) {
              const lastDescSync = metadata.lastSync?.description;
              const formattedDescription = formatTaskDescriptionFromIssue(
                issue.body,
                task.id,
              );
              const echo =
                !!lastDescSync &&
                inboundEcho(
                  lastDescSync,
                  formattedDescription,
                  issue.updated_at,
                  current
                    ? formatTaskDescriptionFromIssue(
                        current.body ?? null,
                        task.id,
                      )
                    : undefined,
                  {
                    linkId: lockedLink.id,
                    field: "description",
                    localValue: task.description || "",
                    confirmation,
                  },
                );
              if (!echo) {
                updateData.description = formattedDescription;
                lastSync.description = inboundStamp(
                  metadata.lastSync?.description,
                  formattedDescription,
                  "github",
                  issue.updated_at,
                );
              }
            }

            if (Object.keys(updateData).length === 0) return;

            await tx.query(
              `UPDATE task SET
                 title = COALESCE($1, title),
                 description = CASE WHEN $2::boolean THEN $3 ELSE description END,
                 updated_at = $4
               WHERE id = $5 AND project_id = $6`,
              [
                updateData.title ?? null,
                updateData.description !== undefined,
                updateData.description ?? null,
                new Date(),
                task.id,
                integration.projectId,
              ],
            );
            await updateExternalLink(tx, lockedLink.id, {
              title: issue.title,
              metadata: updatedMetadata,
            });
            afterCommit(() =>
              deps.events.publish("task.updated", {
                projectId: integration.projectId,
                taskId: lockedLink.taskId,
                ...(updateData.title !== undefined
                  ? { titleChanged: true }
                  : {}),
              }),
            );
          },
          {
            validate: (binding) =>
              issueEditScope(binding) === issueEditScope(integration),
          },
        ),
      () =>
        deferIssueEdit(deps.db, externalLink, integration, [
          ...(changes.title ? ["title" as const] : []),
          ...(changes.body ? ["description" as const] : []),
        ]),
    );
  }
}
