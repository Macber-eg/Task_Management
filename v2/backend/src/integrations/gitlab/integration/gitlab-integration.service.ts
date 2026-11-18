import { randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { normalizeApiServerUrl } from "../../../common/openapi/openapi-document.service";
import { insertReturning, updateReturning } from "../../../database/dml";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { EventBus } from "../../../events/event-bus";
import { GitlabApiError } from "../client/gitlab-api-error";
import { createGitlabClient } from "../client/gitlab-client";
import { verifyGitlabToken } from "../client/verify-gitlab-token";
import {
  defaultGitlabConfig,
  type GitlabConfig,
  type GitlabTokenType,
  getDefaultGitlabConfig,
  tokenTypeOf,
  validateGitlabConfig,
} from "../config";
import { normalizeGitlabBaseUrl, normalizeProjectPath } from "../gitlab-url";
import { parseGitlabBaseUrl, parseGitlabProjectPath } from "./gitlab-input";

function maskToken(token: string): string {
  if (token.length <= 8) {
    return "••••••••";
  }
  return `${token.slice(0, 4)}••••••${token.slice(-4)}`;
}

function pickSettings(config: Partial<GitlabConfig>): Partial<GitlabConfig> {
  const settings: Partial<GitlabConfig> = {};
  if (config.branchPattern !== undefined) {
    settings.branchPattern = config.branchPattern;
  }
  if (config.customBranchRegex !== undefined) {
    settings.customBranchRegex = config.customBranchRegex;
  }
  if (config.commentTaskLinkOnGitlabIssue !== undefined) {
    settings.commentTaskLinkOnGitlabIssue = config.commentTaskLinkOnGitlabIssue;
  }
  if (config.statusTransitions !== undefined) {
    settings.statusTransitions = config.statusTransitions;
  }
  if (config.syncRules !== undefined) settings.syncRules = config.syncRules;
  return settings;
}

/** A project's GitLab integration: read (secrets only for managers), link, settings, unlink. */
@Injectable()
export class GitlabIntegrationService {
  private readonly logger = new Logger("GitlabIntegration");

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  private find(projectId: string) {
    return this.dataSource.manager.findOne(IntegrationEntity, {
      where: { projectId, type: "gitlab" },
    });
  }

  async get(projectId: string, includeSecrets = false) {
    const integration = await this.find(projectId);

    if (!integration) {
      return null;
    }

    const config = JSON.parse(integration.config) as GitlabConfig;

    const apiBase = normalizeApiServerUrl(
      process.env.KANEO_API_URL || "http://localhost:1337",
    );

    return {
      id: integration.id,
      projectId: integration.projectId,
      baseUrl: config.baseUrl,
      projectPath: config.projectPath,
      tokenType: tokenTypeOf(config),
      maskedAccessToken: includeSecrets ? maskToken(config.accessToken) : "",
      webhookUrl: `${apiBase.replace(/\/$/, "")}/gitlab-integration/webhook/${integration.id}`,
      webhookSecret: includeSecrets ? (config.webhookSecret ?? "") : "",
      branchPattern: config.branchPattern || defaultGitlabConfig.branchPattern,
      commentTaskLinkOnGitlabIssue:
        config.commentTaskLinkOnGitlabIssue !== false,
      isActive: integration.isActive,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  /** Links the project (or relinks it, keeping its secret and settings). */
  async create(input: {
    projectId: string;
    baseUrl: string;
    accessToken: string | undefined;
    tokenType: GitlabTokenType;
    projectPath: string;
  }) {
    await this.store(input);
    const integration = await this.get(input.projectId, true);
    if (!integration) {
      throw new HTTPException(500, { message: "Failed to load integration" });
    }
    await this.events.publish("integration.sync_rules_changed", {
      projectId: input.projectId,
      integrationId: integration.id,
    });
    return integration;
  }

  private async store({
    projectId,
    baseUrl,
    accessToken,
    tokenType,
    projectPath,
  }: {
    projectId: string;
    baseUrl: string;
    accessToken: string | undefined;
    tokenType: GitlabTokenType;
    projectPath: string;
  }) {
    const db = this.dataSource.manager;
    const project = await db.findOne(ProjectEntity, {
      where: { id: projectId },
    });

    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const normalizedBase = parseGitlabBaseUrl(baseUrl);
    const normalizedPath = parseGitlabProjectPath(projectPath);

    const existingIntegration = await this.find(projectId);

    let previousConfig: Partial<GitlabConfig> = {};
    if (existingIntegration) {
      try {
        previousConfig = JSON.parse(existingIntegration.config) as GitlabConfig;
      } catch {
        this.logger.warn(
          `Failed to parse existing GitLab integration config (integration ${existingIntegration.id})`,
        );
      }
    }

    const suppliedToken = accessToken?.trim();
    // A saved credential is only authorized for its original server and path.
    if (!suppliedToken && previousConfig.accessToken) {
      let savedBase: string | undefined;
      try {
        savedBase = normalizeGitlabBaseUrl(previousConfig.baseUrl ?? "");
      } catch {
        // Invalid legacy destinations cannot authorize credential reuse.
      }
      if (savedBase !== normalizedBase) {
        throw new HTTPException(400, {
          message: "Enter a new access token when changing the GitLab URL",
        });
      }
    }
    const resolvedToken = suppliedToken || previousConfig.accessToken || "";

    if (!resolvedToken) {
      throw new HTTPException(400, {
        message: "Access token is required",
      });
    }

    try {
      await verifyGitlabToken(normalizedBase, resolvedToken, tokenType);

      const client = createGitlabClient({
        baseUrl: normalizedBase,
        accessToken: resolvedToken,
        tokenType,
      });
      await client.getProject(normalizedPath);
    } catch (error) {
      if (error instanceof GitlabApiError) {
        throw new HTTPException(error.status || 400, {
          message: error.message,
        });
      }
      throw error;
    }

    const allGitlab = await db.find(IntegrationEntity, {
      where: { type: "gitlab" },
    });

    for (const integration of allGitlab) {
      if (integration.projectId === projectId || !integration.isActive) {
        continue;
      }
      try {
        const config = JSON.parse(integration.config) as {
          baseUrl?: string;
          projectPath?: string;
        };
        if (
          normalizeGitlabBaseUrl(config.baseUrl ?? "") === normalizedBase &&
          normalizeProjectPath(config.projectPath ?? "") === normalizedPath
        ) {
          throw new HTTPException(409, {
            message: `Project ${normalizedPath} on this GitLab instance is already linked to another project`,
          });
        }
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        this.logger.warn(
          `Skipping invalid GitLab integration config during conflict check (integration ${integration.id})`,
        );
      }
    }

    const webhookSecret =
      previousConfig.webhookSecret ?? randomBytes(24).toString("hex");

    const config: GitlabConfig = {
      ...getDefaultGitlabConfig(
        normalizedBase,
        resolvedToken,
        tokenType,
        normalizedPath,
        webhookSecret,
      ),
      ...pickSettings(previousConfig),
    };

    const validation = await validateGitlabConfig(config);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.errors?.join(", ") ?? "Invalid config",
      });
    }

    if (existingIntegration) {
      const [updated] = await updateReturning(
        db,
        IntegrationEntity,
        { config: JSON.stringify(config), isActive: true },
        { id: existingIntegration.id, config: existingIntegration.config },
      );

      if (!updated) {
        throw new HTTPException(409, {
          message: "GitLab integration changed; refresh before reconnecting",
        });
      }
      return;
    }

    const created = await insertReturning(db, IntegrationEntity, {
      projectId,
      type: "gitlab",
      config: JSON.stringify(config),
      isActive: true,
    });

    if (!created) {
      throw new HTTPException(500, {
        message: "Failed to create GitLab integration",
      });
    }
  }

  async update(
    projectId: string,
    body: { isActive?: boolean; commentTaskLinkOnGitlabIssue?: boolean },
  ) {
    const db = this.dataSource.manager;
    const row = await this.find(projectId);

    if (!row) {
      throw new HTTPException(404, { message: "Integration not found" });
    }

    let config: GitlabConfig;
    try {
      config = JSON.parse(row.config) as GitlabConfig;
    } catch {
      throw new HTTPException(500, { message: "Invalid integration config" });
    }

    if (body.commentTaskLinkOnGitlabIssue !== undefined) {
      config = {
        ...config,
        commentTaskLinkOnGitlabIssue: body.commentTaskLinkOnGitlabIssue,
      };
    }

    const validation = await validateGitlabConfig(config);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.errors?.join(", ") ?? "Invalid config",
      });
    }

    const [saved] = await updateReturning(
      db,
      IntegrationEntity,
      {
        config: JSON.stringify(config),
        isActive:
          body.isActive !== undefined ? body.isActive : (row.isActive ?? true),
      },
      { id: row.id, config: row.config },
    );
    if (!saved)
      throw new HTTPException(409, {
        message: "Integration changed; refresh before updating settings",
      });

    const updated = await this.get(projectId, true);
    if (!updated) {
      throw new HTTPException(500, { message: "Failed to load integration" });
    }
    if (body.isActive === true && !row.isActive)
      await this.events.publish("integration.sync_rules_changed", {
        projectId,
        integrationId: row.id,
      });
    await this.events.publish("project.updated", {
      projectId,
      linksChanged: true,
    });
    return updated;
  }

  async delete(projectId: string) {
    const integration = await this.find(projectId);

    if (!integration) {
      throw new HTTPException(404, { message: "GitLab integration not found" });
    }

    await this.dataSource.manager.delete(IntegrationEntity, {
      projectId,
      type: "gitlab",
    });

    return { success: true, message: "GitLab integration deleted" };
  }
}
