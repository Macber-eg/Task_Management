import { describe, expect, it } from "vitest";
import { buildDueDateReminderWindows } from "./due-date-reminder-windows";

describe("buildDueDateReminderWindows", () => {
  it("covers the ten minutes before now, shifted back by one due day", () => {
    const windows = buildDueDateReminderWindows(
      new Date("2026-09-24T00:00:00.000Z"),
    );

    expect(windows).toEqual([
      {
        start: new Date("2026-09-22T23:50:00.000Z"),
        end: new Date("2026-09-23T00:00:00.000Z"),
        type: "configured_before",
        notificationType: "due_date_reminder",
      },
      {
        start: new Date("2026-09-22T23:50:00.000Z"),
        end: new Date("2026-09-23T00:00:00.000Z"),
        type: "overdue",
        notificationType: "task_overdue",
      },
    ]);
  });
});
