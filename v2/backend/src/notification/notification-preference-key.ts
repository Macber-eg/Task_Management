export type NotificationCategoryKey =
  | "taskAssignmentEnabled"
  | "taskCommentEnabled"
  | "taskStatusChangeEnabled"
  | "dueDateReminderEnabled";

/** The preference that mutes a notification type, or null if none does. */
export function notificationPreferenceKey(
  type: string | undefined,
): NotificationCategoryKey | null {
  if (type === "task_assignee_changed" || type === "task_created")
    return "taskAssignmentEnabled";
  if (type === "task_comment" || type === "task_mention")
    return "taskCommentEnabled";
  if (type === "task_status_changed") return "taskStatusChangeEnabled";
  if (type === "due_date_reminder" || type === "task_overdue")
    return "dueDateReminderEnabled";
  return null;
}
