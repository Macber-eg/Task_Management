import { describe, expect, it } from "vitest";
import { buildDeliveryContent } from "./delivery-content";

function content(
  type: string,
  eventData: Record<string, unknown> | null = null,
  title: string | null = null,
  body: string | null = null,
) {
  return buildDeliveryContent({ type, title, content: body, eventData });
}

describe("buildDeliveryContent", () => {
  it("prefers a stored title and content", () => {
    expect(content("task_created", null, "Custom", "Text")).toEqual({
      title: "Custom",
      body: "Text",
    });
  });

  it("renders generated notifications from their event data", () => {
    expect(
      content("task_status_changed", {
        taskTitle: "Ship",
        oldStatus: "to-do",
        newStatus: "done",
      }),
    ).toEqual({
      title: "Task status changed",
      body: "Ship moved from to-do to done.",
    });
    expect(content("time_entry_created", { taskTitle: "Ship" }).body).toBe(
      "A time entry was created for Ship.",
    );
    expect(content("task_comment", { commenterName: "Maya" }).title).toBe(
      "Maya commented on your task",
    );
  });

  it("formats due date lead times", () => {
    const body = (leadTimeMinutes: unknown) =>
      content("due_date_reminder", { taskTitle: "Ship", leadTimeMinutes })
        .body;
    expect(body(2880)).toBe('"Ship" is due in 2 days.');
    expect(body(60)).toBe('"Ship" is due in 1 hour.');
    expect(body(45)).toBe('"Ship" is due in 45 minutes.');
    expect(body(undefined)).toBe('"Ship" is due soon.');
  });

  it("falls back for unknown types", () => {
    expect(content("info")).toEqual({
      title: "New Kaneo notification",
      body: "You have a new notification in Kaneo.",
    });
  });
});
