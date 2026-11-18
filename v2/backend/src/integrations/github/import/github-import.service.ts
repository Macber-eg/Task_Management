import { createId } from "@paralleldrive/cuid2";
import { Inject, Injectable } from "@nestjs/common";
import { HTTPException } from "../../../common/errors/http-exception";
import { GithubImportEntity } from "../../../database/entities/github-import.entity";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { insertReturning } from "../../../database/dml";
import { acceptsIssue, readSyncRules } from "../../sync/rules";
import type { GitHubOctokit } from "../app/github-app";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../config/github-config";
import { GITHUB_DEPS, type GitHubDeps } from "../github-deps";
import { applyImportPage, type ImportEvent } from "./apply-import-page";
import { GitHubImportLock } from "./github-import-lock";
import { importConflict } from "./import-conflict";
import {
  fetchImportPage,
  IMPORT_PAGES_PER_REQUEST,
  issuesPageSchema,
} from "./import-pages";
import { importProgress, initialImportState } from "./import-state";

function readConfig(integration: IntegrationEntity): GitHubConfig {
  if (!integration.isActive)
    throw new HTTPException(400, {
      message: "GitHub integration is not active",
    });
  let config: GitHubConfig;
  try {
    config = JSON.parse(integration.config) as GitHubConfig;
  } catch {
    throw new HTTPException(400, {
      message: "Invalid GitHub integration configuration",
    });
  }
  if (!hasVerifiedGitHubBinding(config) || !config.installationId)
    throw new HTTPException(400, {
      message:
        "GitHub integration must be reconnected by a repository administrator",
    });
  return config;
}

/**
 * The resumable GitHub issue import: a bounded number of GraphQL pages per
 * request, each committed with its progress (`github_import`) before the
 * next is fetched.
 */
@Injectable()
export class GitHubImportService {
  constructor(
    @Inject(GITHUB_DEPS) private readonly deps: GitHubDeps,
    private readonly lock: GitHubImportLock,
  ) {}

  importIssues(projectId: string, runId?: string) {
    return this.lock.run(projectId, () => this.importLocked(projectId, runId));
  }

  private async importLocked(projectId: string, runId?: string) {
    const { db, events } = this.deps;
    const project = await db.findOne(ProjectEntity, {
      where: { id: projectId },
    });
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    const integration = await db.findOne(IntegrationEntity, {
      where: { projectId, type: "github" },
    });
    if (!integration)
      throw new HTTPException(404, { message: "GitHub integration not found" });
    const config = readConfig(integration);
    const repositoryId = config.repositoryId;
    if (!repositoryId) throw importConflict();
    let run: GithubImportEntity | null | undefined = await db.findOne(
      GithubImportEntity,
      {
        where: { integrationId: integration.id },
      },
    );
    if (
      runId &&
      (!run || run.runId !== runId || run.state.repositoryId !== repositoryId)
    )
      throw importConflict();
    if (runId && run?.state.phase === "complete")
      return importProgress(run.runId, run.state);
    if (
      !run ||
      run.state.phase === "complete" ||
      run.state.repositoryId !== repositoryId
    ) {
      run = await insertReturning(
        db,
        GithubImportEntity,
        {
          integrationId: integration.id,
          runId: createId(),
          state: initialImportState(repositoryId),
          updatedAt: new Date(),
        },
        { onConflict: { target: ["integrationId"], update: ["runId", "state", "updatedAt"] } },
      );
    }
    if (!run) throw new Error("Failed to start import");
    let octokit: GitHubOctokit;
    try {
      octokit = await this.deps.github.verifiedInstallationOctokit(config, true);
    } catch {
      throw new HTTPException(502, {
        message:
          "GitHub repository could not be verified; check the integration and resume",
      });
    }
    for (
      let page = 0;
      page < IMPORT_PAGES_PER_REQUEST && run.state.phase !== "complete";
      page++
    ) {
      let payload: unknown;
      try {
        payload = await fetchImportPage(octokit, config, run.state);
      } catch {
        throw new HTTPException(502, {
          message: "GitHub import paused; retry to resume saved progress",
        });
      }
      const { admitted, scopeLabels } = await this.admission(
        octokit,
        config,
        integration.config,
        run.state.phase,
        payload,
      );
      const currentRun: GithubImportEntity = run;
      const notifications = new Map<
        string,
        { type: ImportEvent; taskId: string }
      >();
      run = await db.transaction(async (tx) => {
        const currentProject = (await tx.query(
          `SELECT id FROM project WHERE id = $1 AND workspace_id = $2 FOR KEY SHARE`,
          [project.id, project.workspaceId],
        )) as unknown[];
        if (!currentProject.length) throw importConflict();
        // Serialize against integration changes and webhook issue creation. No
        // provider request is made while this transaction holds row locks.
        const [currentIntegration] = (await tx.query(
          `SELECT config, is_active AS "isActive" FROM integration WHERE id = $1 FOR UPDATE`,
          [integration.id],
        )) as { config: string; isActive: boolean | null }[];
        if (
          !currentIntegration ||
          currentIntegration.config !== integration.config ||
          !currentIntegration.isActive
        )
          throw importConflict();
        const state = structuredClone(currentRun.state);
        await applyImportPage(tx, payload, state, {
          integrationId: integration.id,
          project,
          config,
          announce: (taskId, ...types) => {
            for (const type of types)
              notifications.set(`${type}:${taskId}`, { type, taskId });
          },
          admitted,
          scopeLabels,
        });
        const [rows] = (await tx.query(
          `UPDATE github_import SET state = $1, updated_at = $2
           WHERE integration_id = $3 AND run_id = $4 RETURNING run_id AS "runId"`,
          [JSON.stringify(state), new Date(), integration.id, currentRun.runId],
        )) as [unknown[], number];
        if (!rows.length) throw importConflict();
        return { ...currentRun, state };
      });
      // Each bounded page is durable before other clients refresh, including
      // continuation pages that change labels, comments or linked resources.
      for (const { type, taskId } of notifications.values())
        await events.publish(type, { projectId, taskId });
      await events.publish("project.updated", { projectId });
    }
    return importProgress(run.runId, run.state);
  }

  /** Whether the sync rules admit this page's issue, read through REST when a label rule applies. */
  private async admission(
    octokit: GitHubOctokit,
    config: GitHubConfig,
    storedConfig: string,
    phase: string,
    payload: unknown,
  ): Promise<{ admitted: boolean; scopeLabels: unknown }> {
    const rules = readSyncRules(storedConfig);
    let admitted = rules !== null;
    let scopeLabels: unknown = [];
    if (
      phase === "issues" &&
      (rules?.incoming.mode === "labels" || rules?.outgoing.mode === "labels")
    ) {
      const parsed = issuesPageSchema.safeParse(payload);
      const issue = parsed.success
        ? parsed.data.repository.issues.nodes[0]
        : undefined;
      if (issue) {
        try {
          const remote = await octokit.rest.issues.get({
            owner: config.repositoryOwner,
            repo: config.repositoryName,
            issue_number: issue.number,
            request: { timeout: 10_000 },
          });
          scopeLabels = remote.data.labels;
          admitted = acceptsIssue(storedConfig, scopeLabels);
        } catch {
          throw new HTTPException(502, {
            message: "Issue labels could not be read; resume the import later",
          });
        }
      }
    }
    return { admitted, scopeLabels };
  }
}
