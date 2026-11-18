import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { insertReturning, updateReturning } from "../../../database/dml";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { TaskEntity } from "../../../database/entities/task.entity";
import { EventBus } from "../../../events/event-bus";
import { claimTaskNumber } from "../../../task/shared/claim-task-numbers";
import { findExternalLink } from "../../links/external-link-queries";
import { createExternalLink } from "../../links/external-link-writes";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { withIntegrationTask } from "../../links/integration-task-scope";
import { canSyncTask } from "../../sync/eligibility";
import { acceptsIssue } from "../../sync/rules";
import { sameConfig } from "../../sync/same-config";
import { createGitlabClient, type GitlabClient } from "../client/gitlab-client";
import type {
  GitlabIssue,
  GitlabMergeRequest,
} from "../client/gitlab-types";
import type { GitlabConfig } from "../config";
import { taskDescriptionFromIssue } from "../sync/issue-description";
import { resolveMergeRequestTask } from "../webhook/resolve-merge-request-task";
import { importLabelsForTask } from "./import-issue-labels";
import { fetchIssueNotes, importNotesForTask } from "./import-issue-notes";

type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  errors?: string[];
};

const PER_PAGE = 100;
const MAX_PAGES = 50;

/**
 * Imports the linked GitLab project's open issues as tasks (refreshing tasks
 * already linked) and links open merge requests to the tasks they name.
 */
@Injectable()
export class GitlabImportService {
  private readonly logger = new Logger("GitlabImport");

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  private get db(): EntityManager {
    return this.dataSource.manager;
  }

  async importIssues(projectId: string): Promise<ImportResult> {
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    const project = await this.db.findOne(ProjectEntity, {
      where: { id: projectId },
    });

    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const integration = await this.db.findOne(IntegrationEntity, {
      where: { projectId, type: "gitlab" },
    });

    if (!integration) {
      throw new HTTPException(404, { message: "GitLab integration not found" });
    }

    if (!integration.isActive) {
      throw new HTTPException(400, {
        message: "GitLab integration is not active",
      });
    }

    let config: GitlabConfig;
    try {
      config = JSON.parse(integration.config) as GitlabConfig;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Invalid GitLab integration config JSON (integration ${integration.id})`,
      );
      throw new HTTPException(400, {
        message: `Invalid GitLab integration config: ${message}`,
      });
    }

    if (!config.accessToken || !config.baseUrl) {
      throw new HTTPException(400, {
        message: "GitLab access token or base URL not configured",
      });
    }

    const client = createGitlabClient(config);

    const allIssues: GitlabIssue[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const issues = await client.listIssues(config.projectPath, page, "opened");
      if (issues.length === 0) break;
      allIssues.push(...issues);
      if (issues.length < PER_PAGE) break;
    }

    for (const issue of allIssues) {
      // Confidential issues are skipped, same as in the webhook.
      if (issue.confidential) {
        skipped++;
        continue;
      }

      try {
        const result = await this.importSingleIssue(
          issue,
          integration.id,
          projectId,
          project.workspaceId,
          config,
          client,
        );

        if (result === "imported") {
          imported++;
        } else if (result === "updated") {
          updated++;
        } else {
          skipped++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Issue !${issue.iid}: ${message}`);
      }
    }

    const allMergeRequests: GitlabMergeRequest[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const mergeRequests = await client.listMergeRequests(
        config.projectPath,
        page,
      );
      if (mergeRequests.length === 0) break;
      allMergeRequests.push(...mergeRequests);
      if (mergeRequests.length < PER_PAGE) break;
    }

    for (const mergeRequest of allMergeRequests) {
      try {
        await this.linkMergeRequestToTask(
          mergeRequest,
          integration.id,
          projectId,
          project.slug,
          config,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Merge request !${mergeRequest.iid}: ${message}`);
      }
    }

    return {
      imported,
      updated,
      skipped,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  private async importSingleIssue(
    issue: GitlabIssue,
    integrationId: string,
    projectId: string,
    workspaceId: string,
    config: GitlabConfig,
    client: GitlabClient,
  ): Promise<"imported" | "updated" | "skipped"> {
    const existingLink = await findExternalLink(
      this.db,
      integrationId,
      "issue",
      issue.iid.toString(),
    );

    if (!existingLink && !acceptsIssue(config, issue.labels)) return "skipped";

    const labels = issue.labels ?? [];
    const priority = extractIssuePriority(labels);
    const status = extractIssueStatus(labels);

    const notes = await fetchIssueNotes(client, config.projectPath, issue);

    if (existingLink) {
      const result = await withIntegrationTask(
        this.db,
        existingLink.taskId,
        { id: integrationId, projectId, project: { workspaceId } },
        async (tx, afterCommit) => {
          const linked = (await tx.query(
            `SELECT id FROM external_link
             WHERE id = $1 AND task_id = $2 AND integration_id = $3
             FOR UPDATE`,
            [existingLink.id, existingLink.taskId, integrationId],
          )) as unknown[];
          if (
            !linked.length ||
            !(await canSyncTask(tx, existingLink.taskId, integrationId))
          )
            return "skipped" as const;

          await updateReturning(
            tx,
            TaskEntity,
            {
              title: issue.title,
              description: taskDescriptionFromIssue(issue.description),
              ...(priority ? { priority } : {}),
              ...(status ? { status } : {}),
            },
            { id: existingLink.taskId, projectId },
          );

          await importLabelsForTask(tx, labels, existingLink.taskId, workspaceId);
          await importNotesForTask(tx, issue, notes, existingLink.taskId);

          afterCommit(async () => {
            for (const type of [
              "task.updated",
              "task.labels_updated",
              "comment.updated",
            ])
              await this.events.publish(type, {
                projectId,
                taskId: existingLink.taskId,
              });
          });
          return "updated" as const;
        },
      );
      return result ?? "skipped";
    }

    const createdTask = await withIntegrationTask(
      this.db,
      null,
      { id: integrationId, projectId, project: { workspaceId } },
      async (tx) => {
        const binding = await tx.findOne(IntegrationEntity, {
          where: { id: integrationId },
        });
        if (
          !binding ||
          !sameConfig(binding.config, JSON.stringify(config)) ||
          !acceptsIssue(binding.config, issue.labels) ||
          (await findExternalLink(tx, integrationId, "issue", String(issue.iid)))
        )
          return null;
        const number = await claimTaskNumber(tx, projectId);

        const created = await insertReturning(tx, TaskEntity, {
          projectId,
          userId: null,
          title: issue.title,
          description: taskDescriptionFromIssue(issue.description),
          status: status || "to-do",
          priority: priority ?? "low",
          number,
        });

        if (!created) {
          throw new Error("Failed to create task");
        }

        await createExternalLink(tx, {
          taskId: created.id,
          integrationId,
          resourceType: "issue",
          externalId: issue.iid.toString(),
          url: issue.web_url,
          title: issue.title,
          metadata: {
            state: issue.state,
            createdFrom: "gitlab-import",
            author: issue.author?.username ?? issue.author?.name,
          },
        });

        await importLabelsForTask(tx, labels, created.id, workspaceId);
        await canSyncTask(tx, created.id, integrationId, binding.config);
        await importNotesForTask(tx, issue, notes, created.id);

        return created;
      },
    );
    if (!createdTask) return "skipped";

    await this.events.publish("task.created", {
      ...createdTask,
      taskId: createdTask.id,
      userId: createdTask.userId ?? "",
      type: "task",
      content: null,
      source: "gitlab-import",
      integrationId,
      externalId: issue.iid.toString(),
    });

    return "imported";
  }

  private async linkMergeRequestToTask(
    mergeRequest: GitlabMergeRequest,
    integrationId: string,
    projectId: string,
    projectSlug: string,
    config: GitlabConfig,
  ): Promise<void> {
    const branchName = mergeRequest.source_branch;

    if (!branchName) {
      return;
    }

    const task = await resolveMergeRequestTask(this.db, {
      projectId,
      projectSlug,
      config,
      mergeRequest: { ...mergeRequest, source_branch: branchName },
    });

    if (!task) {
      return;
    }

    const existingLink = await findExternalLink(
      this.db,
      integrationId,
      "pull_request",
      mergeRequest.iid.toString(),
    );

    if (existingLink) {
      return;
    }

    await createExternalLink(this.db, {
      taskId: task.id,
      integrationId,
      resourceType: "pull_request",
      externalId: mergeRequest.iid.toString(),
      url: mergeRequest.web_url,
      title: mergeRequest.title,
      metadata: {
        state: mergeRequest.state,
        draft: mergeRequest.draft === true,
        merged: false,
        branch: branchName,
        author: mergeRequest.author?.username ?? mergeRequest.author?.name,
      },
    });
    await this.events.publish("task.updated", { projectId, taskId: task.id });
  }
}
