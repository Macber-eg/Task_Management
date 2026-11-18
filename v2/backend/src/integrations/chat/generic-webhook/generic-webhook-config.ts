import { assertPublicDestination } from "../../../common/outbound/assert-public-destination";
import {
  boolean,
  check,
  integer,
  maxValue,
  minValue,
  number,
  object,
  optional,
  parse,
  pipe,
  string,
  url,
} from "../shared/config-schema";
import {
  type ConfigValidationResult,
  invalidConfig,
} from "../shared/config-validation-result";

export const genericWebhookEventKeys = [
  "taskCreated",
  "taskStatusChanged",
  "taskPriorityChanged",
  "taskTitleChanged",
  "taskDescriptionChanged",
  "taskCommentCreated",
  "taskDeleted",
  "taskMoved",
  "taskDueDateChanged",
  "taskAssigneeChanged",
  "taskUnassigned",
  "dueDateReminder",
] as const;

export type GenericWebhookEventKey = (typeof genericWebhookEventKeys)[number];

export type GenericWebhookHealth = {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureMessage?: string;
  failureCount?: number;
  lastAttempt?: {
    eventName: string;
    taskId: string;
    projectId: string;
    webhookUrl: string;
  };
};

export type GenericWebhookConfig = {
  webhookUrl: string;
  secret?: string;
  health?: GenericWebhookHealth;
  events?: Partial<Record<GenericWebhookEventKey, boolean>>;
  dueDateReminderLeadTimeMinutes?: number;
};

export const genericWebhookConfigSchema = object({
  webhookUrl: pipe(
    string(),
    url(),
    // Runs even after `url()` failed, so an unparseable URL throws and is
    // reported as "Invalid URL", as before.
    check((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    }, "Webhook URL must use http or https"),
  ),
  secret: optional(string()),
  health: optional(
    object({
      lastSuccessAt: optional(string()),
      lastFailureAt: optional(string()),
      lastFailureMessage: optional(string()),
      failureCount: optional(number()),
      lastAttempt: optional(
        object({
          eventName: string(),
          taskId: string(),
          projectId: string(),
          webhookUrl: string(),
        }),
      ),
    }),
  ),
  events: optional(
    object(
      Object.fromEntries(
        genericWebhookEventKeys.map((key) => [key, optional(boolean())]),
      ),
    ),
  ),
  dueDateReminderLeadTimeMinutes: optional(
    pipe(number(), integer(), minValue(5), maxValue(43_200)),
  ),
});

export const defaultGenericWebhookEvents: Record<
  GenericWebhookEventKey,
  boolean
> = {
  taskCreated: true,
  taskStatusChanged: true,
  taskPriorityChanged: false,
  taskTitleChanged: false,
  taskDescriptionChanged: false,
  taskCommentCreated: true,
  taskDeleted: false,
  taskMoved: false,
  taskDueDateChanged: false,
  taskAssigneeChanged: false,
  taskUnassigned: false,
  dueDateReminder: false,
};

export function normalizeGenericWebhookConfig(
  config: GenericWebhookConfig,
): GenericWebhookConfig {
  const secret =
    typeof config.secret === "string"
      ? config.secret.trim() || undefined
      : undefined;

  return {
    ...config,
    secret,
    health: config.health
      ? {
          ...config.health,
          failureCount: config.health.failureCount ?? 0,
        }
      : undefined,
    dueDateReminderLeadTimeMinutes:
      config.dueDateReminderLeadTimeMinutes ?? 1440,
    events: {
      ...defaultGenericWebhookEvents,
      ...config.events,
    },
  };
}

export async function validateGenericWebhookConfig(
  config: unknown,
): Promise<ConfigValidationResult> {
  try {
    const parsed = parse<GenericWebhookConfig>(
      genericWebhookConfigSchema,
      config,
    );
    await assertPublicDestination(parsed.webhookUrl, "Generic webhook");
    return { valid: true };
  } catch (error) {
    return invalidConfig(error);
  }
}
