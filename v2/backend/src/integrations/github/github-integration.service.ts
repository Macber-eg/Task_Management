import { Inject, Injectable } from "@nestjs/common";
import { HTTPException } from "../../common/errors/http-exception";
import { isGithubSsoConfigured } from "../../config/github-sso-env";
import { AccountEntity } from "../../database/entities/account.entity";
import { GithubImportEntity } from "../../database/entities/github-import.entity";
import { IntegrationEntity } from "../../database/entities/integration.entity";
import { ProjectEntity } from "../../database/entities/project.entity";
import { insertReturning } from "../../database/dml";
import {
  defaultGitHubConfig,
  type GitHubConfig,
  hasVerifiedGitHubBinding,
  safeParseGitHubConfig,
  validateGitHubConfig,
} from "./config/github-config";
import { GITHUB_DEPS, type GitHubDeps } from "./github-deps";
import { importProgress } from "./import/import-state";
import { verifyRepositoryOwner } from "./repositories/verify-repository-owner";

/** The project's GitHub integration: read, connect, update and disconnect. */
@Injectable()
export class GitHubIntegrationService {
  constructor(@Inject(GITHUB_DEPS) private readonly deps: GitHubDeps) {}

  async appInfo(userId: string) {
    const account = await this.deps.db.findOne(AccountEntity, {
      where: { userId, providerId: "github" },
      select: { id: true },
    });
    return {
      appName: process.env.GITHUB_APP_NAME || null,
      accountConnected: Boolean(account),
      accountLinkingAvailable: isGithubSsoConfigured(),
    };
  }

  async get(projectId: string) {
    const { db } = this.deps;
    const integration = await db.findOne(IntegrationEntity, {
      where: { projectId, type: "github" },
    });
    if (!integration) return null;

    const config = JSON.parse(integration.config) as GitHubConfig;
    const run = await db.findOne(GithubImportEntity, {
      where: { integrationId: integration.id },
    });

    return {
      ...(run && run.state.repositoryId === config.repositoryId
        ? { importProgress: importProgress(run.runId, run.state) }
        : {}),
      id: integration.id,
      projectId: integration.projectId,
      repositoryOwner: config.repositoryOwner,
      repositoryName: config.repositoryName,
      installationId: config.installationId,
      branchPattern: config.branchPattern || defaultGitHubConfig.branchPattern,
      commentTaskLinkOnGitHubIssue: config.commentTaskLinkOnGitHubIssue !== false,
      isActive: integration.isActive && hasVerifiedGitHubBinding(config),
      requiresVerification: !hasVerifiedGitHubBinding(config),
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  /**
   * Links the project to a repository the caller administers. Reconnecting
   * the same repository refreshes its binding; another repository needs a
   * disconnect first, because link numbers are repository-scoped.
   */
  async create({
    userId,
    projectId,
    repositoryOwner,
    repositoryName,
  }: {
    userId: string;
    projectId: string;
    repositoryOwner: string;
    repositoryName: string;
  }) {
    const { db } = this.deps;
    const project = await db.findOne(ProjectEntity, {
      where: { id: projectId },
    });
    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const binding = await verifyRepositoryOwner(
      this.deps,
      userId,
      repositoryOwner,
      repositoryName,
    );
    const { installationId } = binding;

    const existingIntegration = await db.findOne(IntegrationEntity, {
      where: { projectId, type: "github" },
    });

    let previousConfig = {};
    if (existingIntegration) {
      let previous: unknown;
      try {
        previous = JSON.parse(existingIntegration.config);
      } catch {
        previous = null;
      }
      const parsed = safeParseGitHubConfig(previous);
      const sameRepository =
        parsed !== null &&
        (parsed.repositoryId !== undefined
          ? parsed.repositoryId === binding.repositoryId
          : parsed.repositoryOwner.toLowerCase() ===
              binding.repositoryOwner.toLowerCase() &&
            parsed.repositoryName.toLowerCase() ===
              binding.repositoryName.toLowerCase());
      if (!sameRepository) {
        // External issue/PR numbers are scoped to a repository. Reusing this
        // integration ID would reinterpret its existing links in another repo.
        throw new HTTPException(409, {
          message:
            "Disconnect the current GitHub integration before connecting a different repository",
        });
      }
      if (parsed) previousConfig = parsed;
    }
    const config = { ...defaultGitHubConfig, ...previousConfig, ...binding };

    if (existingIntegration) {
      const [rows] = (await db.query(
        `UPDATE integration SET config = $1, is_active = true, updated_at = $2
         WHERE id = $3 AND config = $4
         RETURNING id, project_id AS "projectId", is_active AS "isActive",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          JSON.stringify(config),
          new Date(),
          existingIntegration.id,
          existingIntegration.config,
        ],
      )) as [
        {
          id: string;
          projectId: string;
          isActive: boolean | null;
          createdAt: Date;
          updatedAt: Date;
        }[],
        number,
      ];
      const updatedIntegration = rows[0];
      if (!updatedIntegration)
        throw new HTTPException(409, {
          message: "GitHub integration changed; refresh before reconnecting",
        });

      return {
        id: updatedIntegration.id,
        projectId: updatedIntegration.projectId,
        repositoryOwner: binding.repositoryOwner,
        repositoryName: binding.repositoryName,
        installationId,
        requiresVerification: false,
        isActive: updatedIntegration.isActive,
        createdAt: updatedIntegration.createdAt,
        updatedAt: updatedIntegration.updatedAt,
      };
    }

    const newIntegration = await insertReturning(db, IntegrationEntity, {
      projectId,
      type: "github",
      config: JSON.stringify(config),
      isActive: true,
    });

    return {
      id: newIntegration?.id,
      projectId: newIntegration?.projectId,
      repositoryOwner: binding.repositoryOwner,
      repositoryName: binding.repositoryName,
      installationId,
      requiresVerification: false,
      isActive: newIntegration?.isActive,
      createdAt: newIntegration?.createdAt,
      updatedAt: newIntegration?.updatedAt,
    };
  }

  async update(
    projectId: string,
    body: { isActive?: boolean; commentTaskLinkOnGitHubIssue?: boolean },
  ) {
    const { db, events } = this.deps;
    const row = await db.findOne(IntegrationEntity, {
      where: { projectId, type: "github" },
    });
    if (!row) {
      throw new HTTPException(404, { message: "Integration not found" });
    }

    let config: GitHubConfig;
    try {
      config = JSON.parse(row.config) as GitHubConfig;
    } catch {
      throw new HTTPException(500, { message: "Invalid integration config" });
    }

    if (body.commentTaskLinkOnGitHubIssue !== undefined) {
      config = {
        ...config,
        commentTaskLinkOnGitHubIssue: body.commentTaskLinkOnGitHubIssue,
      };
    }

    const validation = await validateGitHubConfig(config);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.errors?.join(", ") ?? "Invalid config",
      });
    }

    const [saved] = (await db.query(
      `UPDATE integration SET config = $1, is_active = $2, updated_at = $3
       WHERE id = $4 AND config = $5 RETURNING id`,
      [
        JSON.stringify(config),
        body.isActive !== undefined ? body.isActive : (row.isActive ?? true),
        new Date(),
        row.id,
        row.config,
      ],
    )) as [unknown[], number];
    if (!saved.length)
      throw new HTTPException(409, {
        message: "GitHub integration changed; refresh before updating",
      });

    const updated = await this.get(projectId);
    if (body.isActive === true && !row.isActive)
      await events.publish("integration.sync_rules_changed", {
        projectId,
        integrationId: row.id,
      });
    await events.publish("project.updated", { projectId, linksChanged: true });
    return updated;
  }

  async delete(projectId: string) {
    const { db } = this.deps;
    const existingIntegration = await db.findOne(IntegrationEntity, {
      where: { projectId, type: "github" },
    });
    if (!existingIntegration) {
      throw new HTTPException(404, { message: "GitHub integration not found" });
    }
    await db.delete(IntegrationEntity, { id: existingIntegration.id });
    return { success: true, message: "GitHub integration deleted" };
  }
}
