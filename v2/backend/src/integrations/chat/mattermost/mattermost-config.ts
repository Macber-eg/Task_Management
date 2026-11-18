import { assertPublicDestination } from "../../../common/outbound/assert-public-destination";
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

const mattermostWebhookUrlPattern = /^https:\/\/[^\s]+$/;

export const mattermostEventKeys = [
  "taskCreated",
  "taskStatusChanged",
  "taskPriorityChanged",
  "taskTitleChanged",
  "taskDescriptionChanged",
  "taskCommentCreated",
] as const;

export type MattermostEventKey = (typeof mattermostEventKeys)[number];

export type MattermostConfig = {
  webhookUrl: string;
  channelName?: string;
  events?: Partial<Record<MattermostEventKey, boolean>>;
};

export const mattermostConfigSchema = object({
  webhookUrl: pipe(
    string(),
    regex(mattermostWebhookUrlPattern, "Webhook URL must be an HTTPS URL"),
  ),
  channelName: optional(string()),
  events: optional(
    object(
      Object.fromEntries(
        mattermostEventKeys.map((key) => [key, optional(boolean())]),
      ),
    ),
  ),
});

export const defaultMattermostEvents: Record<MattermostEventKey, boolean> = {
  taskCreated: true,
  taskStatusChanged: true,
  taskPriorityChanged: false,
  taskTitleChanged: false,
  taskDescriptionChanged: false,
  taskCommentCreated: true,
};

export function normalizeMattermostConfig(
  config: MattermostConfig,
): MattermostConfig {
  return {
    ...config,
    channelName: config.channelName?.trim() || undefined,
    events: {
      ...defaultMattermostEvents,
      ...config.events,
    },
  };
}

export async function validateMattermostConfig(
  config: unknown,
): Promise<ConfigValidationResult> {
  try {
    const parsed = parse<MattermostConfig>(mattermostConfigSchema, config);
    // The previous backend shared the generic webhook's destination check,
    // including its error label.
    await assertPublicDestination(parsed.webhookUrl, "Generic webhook");
    return { valid: true };
  } catch (error) {
    return invalidConfig(error);
  }
}
