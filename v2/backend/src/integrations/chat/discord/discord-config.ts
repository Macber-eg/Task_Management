import {
  boolean,
  object,
  optional,
  parse,
  pipe,
  regex,
  string,
  url,
} from "../shared/config-schema";
import {
  type ConfigValidationResult,
  invalidConfig,
} from "../shared/config-validation-result";

export const discordEventKeys = [
  "taskCreated",
  "taskStatusChanged",
  "taskPriorityChanged",
  "taskTitleChanged",
  "taskDescriptionChanged",
  "taskCommentCreated",
] as const;

export type DiscordEventKey = (typeof discordEventKeys)[number];

export type DiscordConfig = {
  webhookUrl: string;
  channelName?: string;
  events?: Partial<Record<DiscordEventKey, boolean>>;
};

export const discordConfigSchema = object({
  webhookUrl: pipe(
    string(),
    url(),
    regex(
      /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/[^/]+\/[^/\s]+$/i,
      "Enter a valid Discord webhook URL",
    ),
  ),
  channelName: optional(string()),
  events: optional(
    object(
      Object.fromEntries(
        discordEventKeys.map((key) => [key, optional(boolean())]),
      ),
    ),
  ),
});

export const defaultDiscordEvents: Record<DiscordEventKey, boolean> = {
  taskCreated: true,
  taskStatusChanged: true,
  taskPriorityChanged: false,
  taskTitleChanged: false,
  taskDescriptionChanged: false,
  taskCommentCreated: true,
};

export function normalizeDiscordConfig(config: DiscordConfig): DiscordConfig {
  return {
    ...config,
    channelName: config.channelName?.trim() || undefined,
    events: {
      ...defaultDiscordEvents,
      ...config.events,
    },
  };
}

export async function validateDiscordConfig(
  config: unknown,
): Promise<ConfigValidationResult> {
  try {
    normalizeDiscordConfig(parse<DiscordConfig>(discordConfigSchema, config));
    return { valid: true };
  } catch (error) {
    return invalidConfig(error);
  }
}
