import { Injectable, Logger } from "@nestjs/common";
import { HTTPException } from "../../../common/errors/http-exception";
import { EventBus } from "../../../events/event-bus";
import { ProjectIntegrationStore } from "../shared/project-integration-store";
import {
  type TelegramIntegrationPatchBody,
  buildNextTelegramConfigFromPatch,
} from "./telegram-config-patch";
import {
  defaultTelegramEvents,
  normalizeTelegramConfig,
  type TelegramEventKey,
  validateTelegramConfig,
} from "./telegram-config";
import {
  parseTelegramIntegrationConfig,
  toTelegramResponse,
} from "./telegram-integration-response";

const TYPE = "telegram";

export type TelegramActor = { userId: string; apiKeyId?: string };

export type CreateTelegramBody = {
  botToken: string;
  chatId: string;
  threadId?: number;
  chatLabel?: string;
  events?: Partial<Record<TelegramEventKey, boolean>>;
};

@Injectable()
export class TelegramIntegrationService {
  private readonly logger = new Logger(TelegramIntegrationService.name);

  constructor(
    private readonly store: ProjectIntegrationStore,
    private readonly events: EventBus,
  ) {}

  async get(projectId: string) {
    const integration = await this.store.find(projectId, TYPE);
    return integration ? toTelegramResponse(integration) : null;
  }

  async create(
    projectId: string,
    body: CreateTelegramBody,
    actor: TelegramActor,
  ) {
    const config = normalizeTelegramConfig({
      botToken: body.botToken,
      chatId: body.chatId,
      threadId: body.threadId,
      chatLabel: body.chatLabel,
      events: { ...defaultTelegramEvents, ...body.events },
    });
    this.assertValid(config);

    const prior = await this.store.find(projectId, TYPE);
    await this.store.upsert(projectId, TYPE, config, { activate: false });

    const integration = await this.get(projectId);
    if (!integration) {
      throw new HTTPException(500, {
        message: "Failed to load Telegram integration after save",
      });
    }
    this.publish(
      prior ? "integration.updated" : "integration.created",
      projectId,
      integration.id,
      actor,
    );
    return integration;
  }

  async update(
    projectId: string,
    body: TelegramIntegrationPatchBody,
    actor: TelegramActor,
  ) {
    const existing = await this.store.find(projectId, TYPE);
    if (!existing) {
      throw new HTTPException(404, {
        message: "Telegram integration not found",
      });
    }

    const currentConfig = parseTelegramIntegrationConfig(existing);
    const nextConfig = normalizeTelegramConfig(
      buildNextTelegramConfigFromPatch(body, currentConfig),
    );
    const resolvedIsActive =
      body.isActive !== undefined ? body.isActive : (existing.isActive ?? true);

    if (
      JSON.stringify(currentConfig) === JSON.stringify(nextConfig) &&
      resolvedIsActive === (existing.isActive ?? true)
    ) {
      return toTelegramResponse(existing);
    }

    this.assertValid(nextConfig);
    await this.store.update(existing.id, {
      config: nextConfig,
      isActive: resolvedIsActive,
    });

    const integration = await this.get(projectId);
    if (!integration) {
      throw new HTTPException(500, {
        message: "Failed to load Telegram integration after update",
      });
    }
    this.publish("integration.updated", projectId, integration.id, actor);
    return integration;
  }

  async delete(projectId: string, actor: TelegramActor) {
    const existing = await this.store.find(projectId, TYPE);
    if (!existing) {
      throw new HTTPException(404, {
        message: "Telegram integration not found",
      });
    }
    await this.store.delete(existing.id);
    this.publish("integration.deleted", projectId, existing.id, actor);
    return { success: true };
  }

  private assertValid(config: unknown) {
    const validation = validateTelegramConfig(config);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.errors?.join(", ") ?? "Invalid config",
      });
    }
  }

  // Fire-and-forget: the settings change has committed either way.
  private publish(
    eventName:
      | "integration.created"
      | "integration.updated"
      | "integration.deleted",
    projectId: string,
    integrationId: string,
    actor: TelegramActor,
  ) {
    void this.events
      .publish(eventName, {
        projectId,
        userId: actor.userId,
        integrationType: TYPE,
        integrationId,
        ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}),
      })
      .catch(() => {
        this.logger.error(`Failed to publish ${eventName}`);
      });
  }
}
