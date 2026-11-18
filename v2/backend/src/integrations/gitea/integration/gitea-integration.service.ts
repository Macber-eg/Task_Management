import { randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { normalizeApiServerUrl } from "../../../common/openapi/openapi-document.service";
import { insertReturning, updateReturning } from "../../../database/dml";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { EventBus } from "../../../events/event-bus";
import { normalizeGiteaBaseUrl } from "../../links/normalize-gitea-base-url";
import { GiteaApiError } from "../client/gitea-api-error";
import { createGiteaClient } from "../client/gitea-client";
import { verifyGiteaToken } from "../client/verify-gitea-token";
import {
  defaultGiteaConfig,
  type GiteaConfig,
  getDefaultGiteaConfig,
  validateGiteaConfig,
} from "../config";
import { resolveVerificationToken } from "./resolve-verification-token";

function maskToken(token: string): string {
  if (token.length <= 8) {
    return "••••••••";
  }
  return `${token.slice(0, 4)}••••••${token.slice(-4)}`;
}

/** A project's Gitea integration: read (secret only for managers), link, settings, unlink. */
@Injectable()
export class GiteaIntegrationService {
  private readonly logger = new Logger("GiteaIntegration");

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  private find(projectId: string) {
    return this.dataSource.manager.findOne(IntegrationEntity, {
      where: { projectId, type: "gitea" },
    });
  }

  resolveVerificationToken(input: {
    projectId: string;
    baseUrl: string;
    accessToken?: string;
  }) {
    return resolveVerificationToken(this.dataSource.manager, input);
  }

  async get(projectId: string, includeWebhookSecret = false) {
    const integration = await this.find(projectId);
    if (!integration) {
      return null;
    }

    const config = JSON.parse(integration.config) as GiteaConfig;

    const apiBase = normalizeApiServerUrl(
      process.env.KANEO_API_URL || "http://localhost:1337",
    );

    return {
      id: integration.id,
      projectId: integration.projectId,
      baseUrl: config.baseUrl,
      repositoryOwner: config.repositoryOwner,
      repositoryName: config.repositoryName,
      maskedAccessToken: maskToken(config.accessToken),
      webhookUrl: `${apiBase.replace(/\/$/, "")}/gitea-integration/webhook/${integration.id}`,
      webhookSecret: includeWebhookSecret ? (config.webhookSecret ?? "") : "",
      branchPattern: config.branchPattern || defaultGiteaConfig.branchPattern,
      commentTaskLinkOnGiteaIssue: config.commentTaskLinkOnGiteaIssue !== false,
      isActive: integration.isActive,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  /** Links the project (or relinks it, keeping its secret and sync rules). */
  async create(input: {
    projectId: string;
    baseUrl: string;
    accessToken: string | undefined;
    repositoryOwner: string;
    repositoryName: string;
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
    repositoryOwner,
    repositoryName,
  }: {
    projectId: string;
    baseUrl: string;
    accessToken: string | undefined;
    repositoryOwner: string;
    repositoryName: string;
  }): Promise<void> {
    const db = this.dataSource.manager;
    const project = await db.findOne(ProjectEntity, {
      where: { id: projectId },
    });

    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const normalizedBase = normalizeGiteaBaseUrl(baseUrl);
    const existingIntegration = await this.find(projectId);

    const resolvedToken = await resolveVerificationToken(db, {
      projectId,
      baseUrl: normalizedBase,
      accessToken,
    });

    try {
      await verifyGiteaToken(normalizedBase, resolvedToken);
      await createGiteaClient({
        baseUrl: normalizedBase,
        accessToken: resolvedToken,
      }).getRepo(repositoryOwner, repositoryName);
    } catch (error) {
      if (error instanceof GiteaApiError) {
        throw new HTTPException(error.status || 400, {
          message: error.message,
        });
      }
      throw error;
    }

    const allGitea = await db.find(IntegrationEntity, {
      where: { type: "gitea" },
    });

    for (const integration of allGitea) {
      if (integration.projectId === projectId || !integration.isActive) {
        continue;
      }
      try {
        const cfg = JSON.parse(integration.config) as {
          baseUrl?: string;
          repositoryOwner?: string;
          repositoryName?: string;
        };
        if (
          normalizeGiteaBaseUrl(cfg.baseUrl ?? "") === normalizedBase &&
          cfg.repositoryOwner === repositoryOwner &&
          cfg.repositoryName === repositoryName
        ) {
          throw new HTTPException(409, {
            message: `Repository ${repositoryOwner}/${repositoryName} on this Gitea instance is already linked to another project`,
          });
        }
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        this.logger.warn(
          `Skipping invalid Gitea integration config during conflict check (integration ${integration.id})`,
        );
      }
    }

    let previousConfig: Partial<GiteaConfig> = {};
    let webhookSecret = randomBytes(24).toString("hex");
    if (existingIntegration) {
      try {
        previousConfig = JSON.parse(existingIntegration.config) as GiteaConfig;
        webhookSecret = previousConfig.webhookSecret ?? webhookSecret;
      } catch {
        this.logger.warn(
          `Failed to parse existing Gitea config for webhook secret (integration ${existingIntegration.id})`,
        );
      }
    }

    const config: GiteaConfig = getDefaultGiteaConfig(
      normalizedBase,
      resolvedToken,
      repositoryOwner,
      repositoryName,
      webhookSecret,
    );

    if (previousConfig.syncRules) config.syncRules = previousConfig.syncRules;

    const validation = await validateGiteaConfig(config);
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
          message: "Gitea integration changed; refresh before reconnecting",
        });
      }
      return;
    }

    const created = await insertReturning(db, IntegrationEntity, {
      projectId,
      type: "gitea",
      config: JSON.stringify(config),
      isActive: true,
    });

    if (!created) {
      throw new HTTPException(500, {
        message: "Failed to create Gitea integration",
      });
    }
  }

  async update(
    projectId: string,
    body: { isActive?: boolean; commentTaskLinkOnGiteaIssue?: boolean },
  ) {
    const row = await this.find(projectId);

    if (!row) {
      throw new HTTPException(404, { message: "Integration not found" });
    }

    let config: GiteaConfig;
    try {
      config = JSON.parse(row.config) as GiteaConfig;
    } catch {
      throw new HTTPException(500, { message: "Invalid integration config" });
    }

    if (body.commentTaskLinkOnGiteaIssue !== undefined) {
      config = {
        ...config,
        commentTaskLinkOnGiteaIssue: body.commentTaskLinkOnGiteaIssue,
      };
    }

    const validation = await validateGiteaConfig(config);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.errors?.join(", ") ?? "Invalid config",
      });
    }

    const [saved] = await updateReturning(
      this.dataSource.manager,
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
      throw new HTTPException(404, { message: "Gitea integration not found" });
    }

    await this.dataSource.manager.delete(IntegrationEntity, {
      projectId,
      type: "gitea",
    });

    return { success: true, message: "Gitea integration deleted" };
  }
}
