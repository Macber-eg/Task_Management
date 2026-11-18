import type { GenericWebhookDelivery } from "./generic-webhook-delivery";
import {
  type GenericWebhookConfig,
  normalizeGenericWebhookConfig,
} from "./generic-webhook-config";

/** Delivers `task.due_date_reminder` when the webhook opted into it. */
export async function sendDueDateReminder(
  delivery: GenericWebhookDelivery,
  config: GenericWebhookConfig,
  taskId: string,
  projectId: string,
  leadTimeMinutes: number,
  dueDate: Date,
): Promise<boolean> {
  const normalizedConfig = normalizeGenericWebhookConfig(config);
  if (!(normalizedConfig.events?.dueDateReminder ?? false)) return false;

  return delivery.sendEvent(
    normalizedConfig,
    "task.due_date_reminder",
    taskId,
    projectId,
    null,
    {
      dueDate: dueDate.toISOString(),
      leadTimeMinutes,
    },
  );
}
