import {
  boolean,
  object,
  optional,
  parse,
  pipe,
  regex,
  string,
} from "../shared/config-schema";
import {
  type ConfigValidationResult,
  invalidConfig,
} from "../shared/config-validation-result";

const slackWebhookUrlPattern =
  /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;

export const slackEventKeys = [
  "taskCreated",
  "taskStatusChanged",
  "taskPriorityChanged",
  "taskTitleChanged",
  "taskDescriptionChanged",
  "taskCommentCreated",
] as const;

export type SlackEventKey = (typeof slackEventKeys)[number];

export type SlackConfig = {
  webhookUrl: string;
  channelName?: string;
  events?: Partial<Record<SlackEventKey, boolean>>;
};

export const slackConfigSchema = object({
  webhookUrl: pipe(
    string(),
    regex(slackWebhookUrlPattern, "Invalid Slack webhook URL"),
  ),
  channelName: optional(string()),
  events: optional(
    object(
      Object.fromEntries(slackEventKeys.map((key) => [key, optional(boolean())])),
    ),
  ),
});

export const defaultSlackEvents: Record<SlackEventKey, boolean> = {
  taskCreated: true,
  taskStatusChanged: true,
  taskPriorityChanged: false,
  taskTitleChanged: false,
  taskDescriptionChanged: false,
  taskCommentCreated: true,
};

export function normalizeSlackConfig(config: SlackConfig): SlackConfig {
  return {
    ...config,
    channelName: config.channelName?.trim() || undefined,
    events: {
      ...defaultSlackEvents,
      ...config.events,
    },
  };
}

export async function validateSlackConfig(
  config: unknown,
): Promise<ConfigValidationResult> {
  try {
    parse(slackConfigSchema, config);
    return { valid: true };
  } catch (error) {
    return invalidConfig(error);
  }
}
