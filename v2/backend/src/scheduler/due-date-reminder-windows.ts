import {
  DUE_DATE_DURATION_MS,
  REMINDER_WINDOW_MINUTES,
} from "./reminder-timing";

export type DueDateReminderType = "configured_before" | "overdue";

export type DueDateReminderWindow = {
  start: Date;
  end: Date;
  type: DueDateReminderType;
  notificationType: "due_date_reminder" | "task_overdue";
};

const MINUTE_MS = 60 * 1000;

/** The due-date ranges one reminder run covers, in stored day-start terms. */
export function buildDueDateReminderWindows(now: Date): DueDateReminderWindow[] {
  // Shift the window to stored day-start timestamps, preserving indexed lookups.
  const nowMs = now.getTime() - DUE_DATE_DURATION_MS;
  const windowEnd = new Date(nowMs);

  return [
    {
      start: new Date(nowMs - REMINDER_WINDOW_MINUTES * MINUTE_MS),
      end: windowEnd,
      type: "configured_before",
      notificationType: "due_date_reminder",
    },
    {
      start: new Date(nowMs - 10 * MINUTE_MS),
      end: windowEnd,
      type: "overdue",
      notificationType: "task_overdue",
    },
  ];
}
