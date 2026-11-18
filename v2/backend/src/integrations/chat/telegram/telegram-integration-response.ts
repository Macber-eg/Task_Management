import { Logger } from "@nestjs/common";
import { HTTPException } from "../../../common/errors/http-exception";
import type { IntegrationEntity } from "../../../database/entities/integration.entity";
import {
  defaultTelegramEvents,
  normalizeTelegramConfig,
  parseTelegramConfig,
  type TelegramConfig,
} from "./telegram-config";

const logger = new Logger("TelegramIntegration");

function maskBotToken(value: string): string {
  const [prefix, suffix = ""] = value.split(":", 2);
  if (!suffix) {
    return "Configured";
  }

  const maskedSuffix =
    suffix.length > 8 ? `${suffix.slice(0, 4)}…${suffix.slice(-4)}` : "••••";
  return `${prefix}:${maskedSuffix}`;
}

function sanitizeTelegramConfigForLog(rawConfig: string): string {
  try {
    const parsed = JSON.parse(rawConfig) as Record<string, unknown>;
    for (const key of [
      "botToken",
      "chatId",
      "threadId",
      "chatLabel",
    ] as const) {
      if (key in parsed) {
        parsed[key] = "[REDACTED]";
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return "[UNPARSEABLE]";
  }
}

/** The stored config, parsed and normalized; a corrupt row answers 500. */
export function parseTelegramIntegrationConfig(
  integration: Pick<IntegrationEntity, "config" | "id" | "projectId">,
): TelegramConfig {
  try {
    return normalizeTelegramConfig(
      parseTelegramConfig(JSON.parse(integration.config)),
    );
  } catch {
    logger.error("Failed to parse Telegram integration config", {
      integrationId: integration.id,
      projectId: integration.projectId,
      sanitizedConfig: sanitizeTelegramConfigForLog(integration.config),
    });
    throw new HTTPException(500, {
      message: "Stored Telegram integration configuration is invalid",
    });
  }
}

export function toTelegramResponse(integration: IntegrationEntity) {
  const config = parseTelegramIntegrationConfig(integration);

  return {
    id: integration.id,
    projectId: integration.projectId,
    chatId: config.chatId,
    threadId: config.threadId ?? null,
    chatLabel: config.chatLabel ?? null,
    botTokenConfigured: Boolean(config.botToken),
    maskedBotToken: config.botToken ? maskBotToken(config.botToken) : "",
    events: {
      ...defaultTelegramEvents,
      ...config.events,
    } as Record<string, boolean>,
    isActive: integration.isActive,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}
