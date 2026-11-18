import { HTTPException } from "../../../common/errors/http-exception";
import type { IntegrationEntity } from "../../../database/entities/integration.entity";
import type { ConfigValidationResult } from "./config-validation-result";
import { maskWebhookUrl } from "./mask-webhook-url";
import type { ProjectIntegrationStore } from "./project-integration-store";

type EventToggles = Record<string, boolean | undefined>;

export type WebhookChannelConfig = {
  webhookUrl: string;
  channelName?: string;
  events?: EventToggles;
};

export type WebhookChannelBody = {
  webhookUrl?: string;
  channelName?: string | null;
  isActive?: boolean;
  events?: EventToggles;
};

/** What differs between the Slack, Discord and Mattermost settings routes. */
export type WebhookChannelOptions<C extends WebhookChannelConfig> = {
  type: string;
  /** Used in "<label> integration not found". */
  label: string;
  defaultEvents: Record<string, boolean>;
  normalize(config: C): C;
  validate(config: unknown): Promise<ConfigValidationResult>;
  /** Discord answers "" for an unset URL instead of masking it. */
  maskEmptyAsBlank?: boolean;
  /** Discord replaces the row with one upsert instead of find-then-write. */
  upsert?: boolean;
  /** Mattermost validates an explicit empty URL instead of keeping the old one. */
  explicitWebhookUrl?: boolean;
};

/**
 * The settings routes of the incoming-webhook chat channels: one integration
 * row per project and type, its webhook URL only ever returned masked.
 */
export class WebhookChannelIntegrations<C extends WebhookChannelConfig> {
  constructor(
    private readonly store: ProjectIntegrationStore,
    private readonly options: WebhookChannelOptions<C>,
  ) {}

  toResponse(integration: IntegrationEntity) {
    const config = this.options.normalize(JSON.parse(integration.config) as C);

    return {
      id: integration.id,
      projectId: integration.projectId,
      channelName: config.channelName ?? null,
      webhookConfigured: Boolean(config.webhookUrl),
      maskedWebhookUrl:
        this.options.maskEmptyAsBlank && !config.webhookUrl
          ? ""
          : maskWebhookUrl(config.webhookUrl),
      events: {
        ...this.options.defaultEvents,
        ...config.events,
      } as Record<string, boolean>,
      isActive: integration.isActive,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  async get(projectId: string) {
    const integration = await this.store.find(projectId, this.options.type);
    return integration ? this.toResponse(integration) : null;
  }

  async create(
    projectId: string,
    body: { webhookUrl: string; channelName?: string; events?: EventToggles },
  ) {
    const config = this.options.normalize({
      webhookUrl: body.webhookUrl,
      channelName: body.channelName,
      events: body.events,
    } as C);
    await this.assertValid(config);

    if (this.options.upsert) {
      await this.store.upsert(projectId, this.options.type, config, {
        activate: true,
      });
    } else {
      const existing = await this.store.find(projectId, this.options.type);
      if (existing) {
        await this.store.update(existing.id, { config, isActive: true });
      } else {
        await this.store.insert(projectId, this.options.type, config);
      }
    }

    return this.get(projectId);
  }

  async update(projectId: string, body: WebhookChannelBody) {
    const existing = await this.findExisting(projectId);
    const currentConfig = this.options.normalize(
      JSON.parse(existing.config) as C,
    );
    const webhookUrl = this.options.explicitWebhookUrl
      ? body.webhookUrl === undefined
        ? currentConfig.webhookUrl
        : body.webhookUrl.trim()
      : body.webhookUrl?.trim() || currentConfig.webhookUrl;
    const nextConfig = this.options.normalize({
      webhookUrl,
      channelName:
        body.channelName === undefined
          ? currentConfig.channelName
          : (body.channelName ?? undefined),
      events: {
        ...currentConfig.events,
        ...body.events,
      },
    } as C);
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
    const existing = await this.store.find(projectId, this.options.type);
    if (!existing) {
      throw new HTTPException(404, {
        message: `${this.options.label} integration not found`,
      });
    }
    return existing;
  }

  private async assertValid(config: C) {
    const validation = await this.options.validate(config);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.errors?.join(", ") ?? "Invalid config",
      });
    }
  }
}
