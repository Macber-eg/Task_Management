import { Injectable } from "@nestjs/common";
import { HTTPException } from "../../../common/errors/http-exception";
import type { IntegrationEntity } from "../../../database/entities/integration.entity";
import { ProjectIntegrationStore } from "../shared/project-integration-store";
import {
  defaultGenericWebhookEvents,
  type GenericWebhookConfig,
  type GenericWebhookEventKey,
  normalizeGenericWebhookConfig,
  validateGenericWebhookConfig,
} from "./generic-webhook-config";

const TYPE = "generic-webhook";

type EventToggles = Partial<Record<GenericWebhookEventKey, boolean>>;

function maskValue(value: string | undefined): string | null {
  if (!value) return null;
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "••••";
}

function toResponse(integration: IntegrationEntity) {
  const config = normalizeGenericWebhookConfig(
    JSON.parse(integration.config) as GenericWebhookConfig,
  );

  return {
    id: integration.id,
    projectId: integration.projectId,
    webhookConfigured: Boolean(config.webhookUrl),
    maskedWebhookUrl: maskValue(config.webhookUrl),
    secretConfigured: Boolean(config.secret),
    maskedSecret: maskValue(config.secret),
    events: {
      ...defaultGenericWebhookEvents,
      ...config.events,
    },
    dueDateReminderLeadTimeMinutes:
      config.dueDateReminderLeadTimeMinutes ?? 1440,
    isActive: integration.isActive,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}

@Injectable()
export class GenericWebhookIntegrationService {
  constructor(private readonly store: ProjectIntegrationStore) {}

  async get(projectId: string) {
    const integration = await this.store.find(projectId, TYPE);
    return integration ? toResponse(integration) : null;
  }

  async create(
    projectId: string,
    body: {
      webhookUrl: string;
      secret?: string;
      events?: EventToggles;
      dueDateReminderLeadTimeMinutes?: number;
    },
  ) {
    const config = normalizeGenericWebhookConfig({
      webhookUrl: body.webhookUrl,
      secret: body.secret,
      events: body.events,
      dueDateReminderLeadTimeMinutes: body.dueDateReminderLeadTimeMinutes,
    });
    await this.assertValid(config);

    const existing = await this.store.find(projectId, TYPE);
    if (existing) {
      await this.store.update(existing.id, { config, isActive: true });
    } else {
      await this.store.insert(projectId, TYPE, config);
    }

    return this.get(projectId);
  }

  async update(
    projectId: string,
    body: {
      webhookUrl?: string;
      secret?: string | null;
      isActive?: boolean;
      events?: EventToggles;
      dueDateReminderLeadTimeMinutes?: number;
    },
  ) {
    const existing = await this.findExisting(projectId);
    const currentConfig = normalizeGenericWebhookConfig(
      JSON.parse(existing.config) as GenericWebhookConfig,
    );
    const nextConfig = normalizeGenericWebhookConfig({
      webhookUrl: body.webhookUrl?.trim() || currentConfig.webhookUrl,
      secret:
        body.secret === undefined
          ? currentConfig.secret
          : (body.secret ?? undefined),
      events: {
        ...currentConfig.events,
        ...body.events,
      },
      dueDateReminderLeadTimeMinutes:
        body.dueDateReminderLeadTimeMinutes ??
        currentConfig.dueDateReminderLeadTimeMinutes,
    });
    await this.assertValid(nextConfig);

    await this.store.update(existing.id, {
      config: nextConfig,
      isActive:
        body.isActive !== undefined
          ? body.isActive
          : (existing.isActive ?? true),
    });

    return this.get(projectId);
  }

  async delete(projectId: string) {
    const existing = await this.findExisting(projectId);
    await this.store.delete(existing.id);
    return { success: true };
  }

  private async findExisting(projectId: string) {
    const existing = await this.store.find(projectId, TYPE);
    if (!existing) {
      throw new HTTPException(404, {
        message: "Generic webhook integration not found",
      });
    }
    return existing;
  }

  private async assertValid(config: GenericWebhookConfig) {
    const validation = await validateGenericWebhookConfig(config);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.errors?.join(", ") ?? "Invalid config",
      });
    }
  }
}
