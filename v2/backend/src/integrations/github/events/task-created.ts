import { Logger } from "@nestjs/common";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { taskUrl } from "../../chat/shared/task-url";
import type { PluginContext, TaskCreatedEvent } from "../../core/task-events";
import { findExternalLinkByTaskAndType } from "../../links/external-link-queries";
import {
  createExternalLink,
  updateExternalLink,
} from "../../links/external-link-writes";
import { formatIssueBody, formatIssueTitle } from "../../links/issue-format";
import { withTaskSyncCreation } from "../../sync/create-task-issue";
import { canSyncTask } from "../../sync/eligibility";
import {
  initializeTaskIssue,
  isIssueInitializationPending,
} from "../../sync/initialize-task-issue";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import { githubIssueAccess } from "../issues/github-issue-access";
import { sendIssueLabelChanges } from "../labels/send-issue-label-changes";
import { taskLinkCommentExists } from "./task-link-comment-exists";

const logger = new Logger("GitHubTaskCreated");

/** Exports a task as a GitHub issue once (see `withTaskSyncCreation`). */
export async function handleTaskCreated(
  deps: GitHubDeps,
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  await withTaskSyncCreation(deps.db, event, context, (current) =>
    createTaskIssue(deps, current, context),
  );
}

async function createTaskIssue(
  deps: GitHubDeps,
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  const { db } = deps;
  if (!deps.github.app()) return;

  const config = context.config as GitHubConfig;
  if (!hasVerifiedGitHubBinding(config)) return;
  const owner = config.repositoryOwner;
  const repo = config.repositoryName;
  const expectedConfig = JSON.stringify(context.config);

  const existingLink = await findExternalLinkByTaskAndType(
    db,
    event.taskId,
    context.integrationId,
    "issue",
  );
  if (existingLink && !isIssueInitializationPending(existingLink)) return;

  try {
    const octokit = await deps.github.verifiedInstallationOctokit(config, true);

    if (
      !(await canSyncTask(db, event.taskId, context.integrationId, expectedConfig))
    )
      return;

    let createdLink: { id: string; metadata?: string | null } | undefined =
      existingLink ?? undefined;
    let issueNumber = existingLink ? Number(existingLink.externalId) : 0;
    if (!existingLink) {
      const createdIssue = await octokit.rest.issues.create({
        owner,
        repo,
        title: formatIssueTitle(event.title),
        body: formatIssueBody(event.description, event.taskId),
      });

      createdLink = await createExternalLink(db, {
        taskId: event.taskId,
        integrationId: context.integrationId,
        resourceType: "issue",
        externalId: createdIssue.data.number.toString(),
        url: createdIssue.data.html_url,
        title: createdIssue.data.title,
        metadata: {
          state: createdIssue.data.state,
          createdFrom: "kaneo",
          syncInitializationPending: true,
          syncCreatedText: {
            title: event.title,
            description: event.description ?? "",
          },
        },
      });
      issueNumber = createdIssue.data.number;
    }
    if (!createdLink) return;
    const link = createdLink;

    if (
      !(await canSyncTask(db, event.taskId, context.integrationId, expectedConfig))
    ) {
      await updateExternalLink(db, link.id, {
        metadata: { syncFilterPaused: true },
      });
      return;
    }

    let comment: string | undefined;
    if (config.commentTaskLinkOnGitHubIssue !== false) {
      const project = await db.findOne(ProjectEntity, {
        where: { id: event.projectId },
      });
      if (project) {
        const url = taskUrl({
          id: event.taskId,
          projectId: event.projectId,
          workspaceId: project.workspaceId,
        });
        comment = `[${project.slug.toUpperCase()}-${event.number}](${url})`;
      }
    }
    const body = comment;
    await initializeTaskIssue(db, deps.events, event, context, link, {
      text: async (field, value) =>
        (
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            ...(field === "title"
              ? { title: formatIssueTitle(value) }
              : { body: formatIssueBody(value, event.taskId) }),
          })
        )?.data?.updated_at,
      state: async (value) =>
        (
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            state: value === "closed" ? "closed" : "open",
          })
        )?.data?.updated_at,
      labels: async () =>
        syncTaskFieldLabels(
          db,
          await githubIssueAccess(
            deps.github,
            { config: expectedConfig },
            { externalId: String(issueNumber), taskId: event.taskId },
          ),
          event.taskId,
          context,
          { id: link.id, externalId: String(issueNumber) },
          "initialization",
          sendIssueLabelChanges(octokit, owner, repo, issueNumber, true),
        ),
      ...(body
        ? {
            ...(existingLink
              ? {
                  commentExists: () =>
                    taskLinkCommentExists(
                      octokit,
                      owner,
                      repo,
                      issueNumber,
                      body,
                    ),
                }
              : {}),
            comment: () =>
              octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: issueNumber,
                body,
              }),
          }
        : {}),
    });
  } catch (error) {
    logger.error(`Failed to create GitHub issue: ${String(error)}`);
  }
}
