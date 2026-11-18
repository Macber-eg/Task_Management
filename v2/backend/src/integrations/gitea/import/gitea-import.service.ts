import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { insertReturning } from "../../../database/dml";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { TaskEntity } from "../../../database/entities/task.entity";
import { EventBus } from "../../../events/event-bus";
import { claimTaskNumber } from "../../../task/shared/claim-task-numbers";
import { resolvePullRequestTask } from "../../git-shared/resolve-pull-request-task";
import { findExternalLink } from "../../links/external-link-queries";
import { createExternalLink } from "../../links/external-link-writes";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { withIntegrationTask } from "../../links/integration-task-scope";
import { formatTaskDescriptionFromIssue } from "../../links/issue-format";
import { canSyncTask } from "../../sync/eligibility";
import { acceptsIssue } from "../../sync/rules";
import { sameConfig } from "../../sync/same-config";
import { createGiteaClient, type GiteaClient } from "../client/gitea-client";
import type { GiteaIssue, GiteaPullRequest } from "../client/gitea-types";
import type { GiteaConfig } from "../config";
import {
  fetchIssueComments,
  importCommentsForTask,
} from "./import-issue-comments";
import { importTaskLabels } from "./import-task-labels";

type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  errors?: string[];
};

type ImportScope = {
  integrationId: string;
  projectId: string;
  workspaceId: string;
  config: GiteaConfig;
  client: GiteaClient;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * `POST /gitea-integration/import-issues`: imports the repository's open
 * issues as tasks (refreshing already linked ones), then links its open pull
 * requests to the tasks they name.
 */
@Injectable()
export class GiteaImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async importIssues(projectId: string): Promise<ImportResult> {
    const db = this.dataSource.manager;
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    const project = await db.findOne(ProjectEntity, {
      where: { id: projectId },
    });

    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const integration = await db.findOne(IntegrationEntity, {
      where: { projectId, type: "gitea" },
    });

    if (!integration) {
      throw new HTTPException(404, { message: "Gitea integration not found" });
    }

    if (!integration.isActive) {
      throw new HTTPException(400, {
        message: "Gitea integration is not active",
      });
    }

    let config: GiteaConfig;
    try {
      config = JSON.parse(integration.config) as GiteaConfig;
    } catch (error) {
      throw new HTTPException(400, {
        message: `Invalid Gitea integration config: ${errorMessage(error)}`,
      });
    }

    if (!config.accessToken || !config.baseUrl) {
      throw new HTTPException(400, {
        message: "Gitea access token or base URL not configured",
      });
    }

    const client = createGiteaClient(config);
    const scope: ImportScope = {
      integrationId: integration.id,
      projectId,
      workspaceId: project.workspaceId,
      config,
      client,
    };

    const allIssues: GiteaIssue[] = [];
    let page = 1;

    while (true) {
      const issues = await client.listIssues(
        config.repositoryOwner,
        config.repositoryName,
        page,
        "open",
      );

      if (issues.length === 0) break;

      allIssues.push(...issues.filter((issue) => !issue.pull_request));

      if (issues.length < 100) break;
      page++;
    }

    for (const issue of allIssues) {
      try {
        const result = await this.importSingleIssue(issue, scope);

        if (result === "imported") {
          imported++;
        } else if (result === "updated") {
          updated++;
        } else {
          skipped++;
        }
      } catch (error) {
        errors.push(`Issue #${issue.number}: ${errorMessage(error)}`);
      }
    }

    const allPRs: GiteaPullRequest[] = [];
    page = 1;

    while (true) {
      const pulls = await client.listPulls(
        config.repositoryOwner,
        config.repositoryName,
        page,
      );

      if (pulls.length === 0) break;

      allPRs.push(...pulls);

      if (pulls.length < 100) break;
      page++;
    }

    for (const pr of allPRs) {
      try {
        if (!pr.head?.ref) {
          continue;
        }
        await this.linkPullRequestToTask(
          { ...pr, head: { ref: pr.head.ref } },
          scope,
          project.slug,
        );
      } catch (error) {
        errors.push(`PR #${pr.number}: ${errorMessage(error)}`);
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
    issue: GiteaIssue,
    { integrationId, projectId, workspaceId, config, client }: ImportScope,
  ): Promise<"imported" | "updated" | "skipped"> {
    const db = this.dataSource.manager;
    const existingLink = await findExternalLink(
      db,
      integrationId,
      "issue",
      issue.number.toString(),
    );

    if (!existingLink && !acceptsIssue(config, issue.labels)) return "skipped";

    const labels = issue.labels ?? [];
    const adaptedLabels = labels.map((label) => ({ name: label.name }));
    const priority = extractIssuePriority(adaptedLabels);
    const status = extractIssueStatus(adaptedLabels);

    const comments = await fetchIssueComments(issue.number, config, client);
    const integrationScope = {
      id: integrationId,
      projectId,
      project: { workspaceId },
    };

    if (existingLink) {
      const result = await withIntegrationTask(
        db,
        existingLink.taskId,
        integrationScope,
        async (tx, afterCommit) => {
          const linked = await tx
            .createQueryBuilder(ExternalLinkEntity, "link")
            .where("link.id = :id", { id: existingLink.id })
            .andWhere("link.task_id = :taskId", {
              taskId: existingLink.taskId,
            })
            .andWhere("link.integration_id = :integrationId", {
              integrationId,
            })
            .setLock("pessimistic_write")
            .getOne();
          if (
            !linked ||
            !(await canSyncTask(tx, existingLink.taskId, integrationId))
          )
            return "skipped" as const;

          const set = ["title = $3", "description = $4"];
          const values: unknown[] = [
            existingLink.taskId,
            projectId,
            issue.title,
            formatTaskDescriptionFromIssue(issue.body),
          ];
          if (priority) {
            values.push(priority);
            set.push(`priority = $${values.length}`);
          }
          if (status) {
            values.push(status);
            set.push(`status = $${values.length}`);
          }
          values.push(new Date());
          set.push(`updated_at = $${values.length}`);
          await tx.query(
            `UPDATE task SET ${set.join(", ")} WHERE id = $1 AND project_id = $2`,
            values,
          );

          await importTaskLabels(tx, labels, existingLink.taskId, workspaceId);
          await canSyncTask(tx, existingLink.taskId, integrationId);

          await importCommentsForTask(tx, comments, existingLink.taskId);

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
      db,
      null,
      integrationScope,
      (tx) =>
        this.createIssueTask(tx, issue, {
          integrationId,
          projectId,
          workspaceId,
          config,
          priority,
          status,
          comments,
        }),
    );
    if (!createdTask) return "skipped";

    await this.events.publish("task.created", {
      ...createdTask,
      taskId: createdTask.id,
      userId: createdTask.userId ?? "",
      type: "task",
      content: null,
      source: "gitea-import",
      integrationId,
      externalId: issue.number.toString(),
    });

    return "imported";
  }

  private async createIssueTask(
    tx: EntityManager,
    issue: GiteaIssue,
    {
      integrationId,
      projectId,
      workspaceId,
      config,
      priority,
      status,
      comments,
    }: Omit<ImportScope, "client"> & {
      priority: string | null;
      status: string | null;
      comments: Awaited<ReturnType<typeof fetchIssueComments>>;
    },
  ): Promise<TaskEntity | null> {
    const binding = await tx.findOne(IntegrationEntity, {
      where: { id: integrationId },
    });
    if (
      !binding ||
      !sameConfig(binding.config, JSON.stringify(config)) ||
      !acceptsIssue(binding.config, issue.labels) ||
      (await findExternalLink(tx, integrationId, "issue", String(issue.number)))
    )
      return null;
    const nextNumber = await claimTaskNumber(tx, projectId);

    const created = await insertReturning(tx, TaskEntity, {
      projectId,
      userId: null,
      title: issue.title,
      description: formatTaskDescriptionFromIssue(issue.body),
      status: status || "to-do",
      priority: priority ?? "low",
      number: nextNumber,
    });

    if (!created) {
      throw new Error("Failed to create task");
    }

    await createExternalLink(tx, {
      taskId: created.id,
      integrationId,
      resourceType: "issue",
      externalId: issue.number.toString(),
      url: issue.html_url,
      title: issue.title,
      metadata: {
        state: issue.state,
        createdFrom: "gitea-import",
        author: issue.user?.login ?? issue.user?.username,
      },
    });

    await importTaskLabels(tx, issue.labels, created.id, workspaceId);
    await canSyncTask(tx, created.id, integrationId, binding.config);

    await importCommentsForTask(tx, comments, created.id);

    return created;
  }

  private async linkPullRequestToTask(
    pr: GiteaPullRequest & { head: { ref: string } },
    { integrationId, projectId, config }: ImportScope,
    projectSlug: string,
  ): Promise<void> {
    const db = this.dataSource.manager;
    const existingLink = await findExternalLink(
      db,
      integrationId,
      "pull_request",
      pr.number.toString(),
    );
    if (existingLink) return;

    const task = await resolvePullRequestTask(db, {
      integrationId,
      projectId,
      projectSlug,
      config,
      repositoryUrl: `${config.baseUrl.replace(/\/$/, "")}/${config.repositoryOwner}/${config.repositoryName}`,
      pullRequest: pr,
    });
    if (!task) return;

    await createExternalLink(db, {
      taskId: task.id,
      integrationId,
      resourceType: "pull_request",
      externalId: pr.number.toString(),
      url: pr.html_url,
      title: pr.title,
      metadata: {
        state: pr.state,
        branch: pr.head.ref,
        author: pr.user?.login ?? pr.user?.username,
      },
    });
    await this.events.publish("task.updated", { projectId, taskId: task.id });
  }
}
