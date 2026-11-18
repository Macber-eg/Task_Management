import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ColumnEntity } from "../../src/database/entities/column.entity";
import { NotificationEntity } from "../../src/database/entities/notification.entity";
import { TaskReminderSentEntity } from "../../src/database/entities/task-reminder-sent.entity";
import { UserNotificationPreferenceEntity } from "../../src/database/entities/user-notification-preference.entity";
import { NotificationCreationService } from "../../src/notification/notification-creation.service";
import { DueDateReminders } from "../../src/scheduler/due-date-reminders.service";
import { DUE_DATE_DURATION_MS } from "../../src/scheduler/reminder-timing";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const MINUTE_MS = 60 * 1000;
const DEFAULT_LEAD_TIME_MINUTES = 1440;

let app: TestApp;
let nextTaskNumber = 1;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  nextTaskNumber = 1;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function checkDueDateReminders() {
  return app.get(DueDateReminders).checkDueDateReminders();
}

// Reminders fire when `dueDate + duration - leadTime` lands in the trailing
// ten-minute window. Five minutes inside keeps the fixture off both edges
// however long the suite takes.
function dueDateInsideReminderWindow() {
  return new Date(
    Date.now() +
      (DEFAULT_LEAD_TIME_MINUTES - 5) * MINUTE_MS -
      DUE_DATE_DURATION_MS,
  );
}

async function seedScene() {
  const { user, workspace } = await createWorkspaceMember(app.db, {
    role: "owner",
  });
  const { project, columns } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  return { user, workspace, project, columns };
}

type Scene = Awaited<ReturnType<typeof seedScene>>;

function seedTask(
  scene: Scene,
  {
    status,
    column = scene.columns.todo,
    dueDate = dueDateInsideReminderWindow(),
  }: { status: string; column?: ColumnEntity; dueDate?: Date },
) {
  const number = nextTaskNumber++;
  return createTask(app.db, {
    projectId: scene.project.id,
    columnId: column.id,
    userId: scene.user.id,
    title: `Task ${number}`,
    number,
    status,
    dueDate,
  });
}

function notificationsFor(taskId: string) {
  return app.db.find(NotificationEntity, { where: { resourceId: taskId } });
}

function remindersSentFor(taskId: string) {
  return app.db.find(TaskReminderSentEntity, { where: { taskId } });
}

describe("due date reminders", () => {
  it("notifies the assignee about an open task inside the window, once", async () => {
    const scene = await seedScene();
    const task = await seedTask(scene, { status: "to-do" });

    expect(await checkDueDateReminders()).toEqual({ degraded: false });

    const notifications = await notificationsFor(task.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "due_date_reminder",
      userId: scene.user.id,
      resourceType: "task",
      eventData: {
        taskTitle: task.title,
        reminderType: "configured_before",
        leadTimeMinutes: 1440,
        dueDate: task.dueDate?.toISOString(),
      },
    });
    expect(await remindersSentFor(task.id)).toEqual([
      expect.objectContaining({ reminderType: "configured_before" }),
    ]);

    await checkDueDateReminders();

    expect(await notificationsFor(task.id)).toHaveLength(1);
    expect(await remindersSentFor(task.id)).toHaveLength(1);
  });

  it("stays silent about an archived task with the same due date", async () => {
    const scene = await seedScene();
    const task = await seedTask(scene, { status: "archived" });

    await checkDueDateReminders();

    expect(await notificationsFor(task.id)).toHaveLength(0);
    expect(await remindersSentFor(task.id)).toHaveLength(0);
  });

  it("skips only the archived task when both are due", async () => {
    const scene = await seedScene();
    const open = await seedTask(scene, { status: "to-do" });
    const archived = await seedTask(scene, { status: "archived" });

    await checkDueDateReminders();

    const notifications = await app.db.find(NotificationEntity);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.resourceId).toBe(open.id);
    expect(await notificationsFor(archived.id)).toHaveLength(0);
  });

  it("still notifies about planned tasks, which are not archived", async () => {
    const scene = await seedScene();
    const task = await seedTask(scene, { status: "planned" });

    await checkDueDateReminders();

    expect(await notificationsFor(task.id)).toHaveLength(1);
  });

  it("stays silent about a task in a final column", async () => {
    const scene = await seedScene();
    const task = await seedTask(scene, {
      status: "done",
      column: scene.columns.done,
    });

    await checkDueDateReminders();

    expect(await notificationsFor(task.id)).toHaveLength(0);
  });
});

describe("date-only reminders", () => {
  async function seedReminder({
    dueDate = "2026-09-23T00:00:00.000Z",
    leadTimeMinutes = 14 * 60,
    completed = false,
    enabled = true,
  }: {
    dueDate?: string;
    leadTimeMinutes?: number | null;
    completed?: boolean;
    enabled?: boolean;
  } = {}) {
    const scene = await seedScene();
    const task = await seedTask(scene, {
      status: completed ? "done" : "to-do",
      column: completed ? scene.columns.done : scene.columns.todo,
      dueDate: new Date(dueDate),
    });
    if (leadTimeMinutes !== null) {
      await insertRow(app.db, UserNotificationPreferenceEntity, {
        userId: scene.user.id,
        dueDateReminderLeadTimeMinutes: leadTimeMinutes,
        dueDateReminderEnabled: enabled,
      });
    }
    return task;
  }

  async function at(now: string) {
    vi.setSystemTime(new Date(now));
    await checkDueDateReminders();
  }

  function notificationTypes() {
    return app.db
      .find(NotificationEntity)
      .then((rows) => rows.map((row) => row.type));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it.each([
    [
      "2026-09-23T00:00:00.000Z",
      "2026-09-22T10:00:00.000Z",
      "2026-09-23T10:00:00.000Z",
    ],
    [
      "2026-09-23T00:00:00+02:00",
      "2026-09-22T10:00:00+02:00",
      "2026-09-23T10:00:00+02:00",
    ],
    [
      "2026-09-23T00:00:00-07:00",
      "2026-09-22T10:00:00-07:00",
      "2026-09-23T10:00:00-07:00",
    ],
  ])(
    "sends fourteen-hour reminders on the due day for %s",
    async (dueDate, early, expected) => {
      const task = await seedReminder({ dueDate });

      await at(early);
      expect(await notificationTypes()).toEqual([]);
      expect(await app.db.count(TaskReminderSentEntity)).toBe(0);

      await at(expected);
      const notifications = await app.db.find(NotificationEntity);
      expect(notifications).toEqual([
        expect.objectContaining({
          type: "due_date_reminder",
          resourceId: task.id,
          eventData: expect.objectContaining({
            dueDate: task.dueDate?.toISOString(),
            leadTimeMinutes: 840,
          }),
        }),
      ]);

      await at(new Date(new Date(expected).getTime() + 5 * MINUTE_MS).toISOString());
      expect(await notificationTypes()).toEqual(["due_date_reminder"]);
    },
  );

  it("does not mark a task overdue until the due day ends", async () => {
    const task = await seedReminder();
    for (const now of ["2026-09-23T00:00:00Z", "2026-09-23T23:59:59.999Z"]) {
      await at(now);
      expect(
        await app.db.countBy(NotificationEntity, { type: "task_overdue" }),
      ).toBe(0);
    }

    await at("2026-09-24T00:00:00Z");

    expect(
      await app.db.find(NotificationEntity, { where: { type: "task_overdue" } }),
    ).toEqual([expect.objectContaining({ resourceId: task.id })]);
  });

  it("uses expiration for the default one-day lead time without preferences", async () => {
    await seedReminder({ leadTimeMinutes: null });

    await at("2026-09-22T00:00:00Z");
    expect(await notificationTypes()).toEqual([]);

    await at("2026-09-23T00:00:00Z");
    expect(await notificationTypes()).toEqual(["due_date_reminder"]);
  });

  it.each([
    ["2026-09-23T09:59:59.999Z", 0],
    ["2026-09-23T10:10:00.000Z", 1],
    ["2026-09-23T10:10:00.001Z", 0],
  ])("respects the delivery window at %s", async (now, count) => {
    await seedReminder();

    await at(now);

    expect(await app.db.count(NotificationEntity)).toBe(count);
  });

  it.each([{ completed: true }, { enabled: false }])(
    "skips reminders when %j",
    async (options) => {
      await seedReminder(options);
      for (const now of ["2026-09-23T10:00:00Z", "2026-09-24T00:00:00Z"]) {
        await at(now);
      }
      expect(await app.db.count(NotificationEntity)).toBe(0);
      expect(await app.db.count(TaskReminderSentEntity)).toBe(0);
    },
  );
});

describe("reminder atomicity", () => {
  it("rolls back both writes after a successful notification insert, then retries once", async () => {
    const scene = await seedScene();
    await seedTask(scene, { status: "to-do" });
    const creation = app.get(NotificationCreationService);
    const persist = creation.persistNotification.bind(creation);
    const spy = vi
      .spyOn(creation, "persistNotification")
      .mockImplementationOnce(async (...args) => {
        await persist(...args);
        throw new Error("temporary notification failure after insert");
      });

    expect(await checkDueDateReminders()).toEqual({ degraded: true });
    expect(await app.db.count(TaskReminderSentEntity)).toBe(0);
    expect(await app.db.count(NotificationEntity)).toBe(0);

    spy.mockRestore();
    expect(await checkDueDateReminders()).toEqual({ degraded: false });
    await checkDueDateReminders();
    expect(await app.db.count(TaskReminderSentEntity)).toBe(1);
    expect(await app.db.count(NotificationEntity)).toBe(1);
  });

  it("releases the reminder claim after PostgreSQL rejects the notification insert", async () => {
    const scene = await seedScene();
    await seedTask(scene, { status: "to-do" });
    await app.dataSource.query(`CREATE FUNCTION reject_reminder_notification() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test notification insert failure'; END;
    $$ LANGUAGE plpgsql`);
    await app.dataSource.query(`CREATE TRIGGER reject_reminder_notification BEFORE INSERT ON notification
      FOR EACH ROW EXECUTE FUNCTION reject_reminder_notification()`);
    try {
      expect(await checkDueDateReminders()).toEqual({ degraded: true });
      expect(await app.db.count(TaskReminderSentEntity)).toBe(0);
      expect(await app.db.count(NotificationEntity)).toBe(0);
    } finally {
      await app.dataSource.query(
        "DROP TRIGGER reject_reminder_notification ON notification",
      );
      await app.dataSource.query("DROP FUNCTION reject_reminder_notification()");
    }

    expect(await checkDueDateReminders()).toEqual({ degraded: false });
    await checkDueDateReminders();
    expect(await app.db.count(TaskReminderSentEntity)).toBe(1);
    expect(await app.db.count(NotificationEntity)).toBe(1);
  });

  it("keeps the claim free when the assignee muted due-date reminders", async () => {
    const scene = await seedScene();
    const task = await seedTask(scene, { status: "to-do" });
    vi.spyOn(
      app.get(NotificationCreationService),
      "persistNotification",
    ).mockResolvedValue(null);

    await checkDueDateReminders();

    expect(await remindersSentFor(task.id)).toHaveLength(0);
  });
});
