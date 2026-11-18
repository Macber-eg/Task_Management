import {
  boolean,
  integer,
  minLength,
  minValue,
  number,
  object,
  optional,
  parse,
  pipe,
  regex,
  string,
  trim,
} from "../shared/config-schema";
import type { ConfigValidationResult } from "../shared/config-validation-result";
import { invalidConfig } from "../shared/config-validation-result";

export const telegramEventKeys = [
  "taskCreated",
  "taskStatusChanged",
  "taskPriorityChanged",
  "taskTitleChanged",
  "taskDescriptionChanged",
  "taskCommentCreated",
] as const;

export type TelegramEventKey = (typeof telegramEventKeys)[number];

export type TelegramConfig = {
  botToken: string;
  chatId: string;
  threadId?: number;
  chatLabel?: string;
  events?: Partial<Record<TelegramEventKey, boolean>>;
};

/** Parsing trims `chatId` and drops keys the schema does not declare. */
export const telegramConfigSchema = object({
  botToken: pipe(
    string(),
    regex(/^\d{8,10}:[A-Za-z0-9_-]{35}$/, "Enter a valid Telegram bot token"),
  ),
  chatId: pipe(string(), trim(), minLength(1, "Chat ID is required")),
  threadId: optional(pipe(number(), integer(), minValue(1))),
  chatLabel: optional(string()),
  events: optional(
    object(
      Object.fromEntries(
        telegramEventKeys.map((key) => [key, optional(boolean())]),
      ),
    ),
  ),
});

export const defaultTelegramEvents: Record<TelegramEventKey, boolean> = {
  taskCreated: true,
  taskStatusChanged: true,
  taskPriorityChanged: false,
  taskTitleChanged: false,
  taskDescriptionChanged: false,
  taskCommentCreated: true,
};

export function parseTelegramConfig(config: unknown): TelegramConfig {
  return parse<TelegramConfig>(telegramConfigSchema, config);
}

export function normalizeTelegramConfig(
  config: TelegramConfig,
): TelegramConfig {
  return {
    ...config,
    threadId:
      typeof config.threadId === "number" && Number.isFinite(config.threadId)
        ? config.threadId
        : undefined,
    chatLabel: config.chatLabel?.trim() || undefined,
    events: {
      ...defaultTelegramEvents,
      ...config.events,
    },
  };
}

export function validateTelegramConfig(
  config: unknown,
): ConfigValidationResult {
  try {
    normalizeTelegramConfig(parseTelegramConfig(config));
    return { valid: true };
  } catch (error) {
    return invalidConfig(error);
  }
}
