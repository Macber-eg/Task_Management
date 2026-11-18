import { Logger } from "@nestjs/common";
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
import { NotificationEntity } from "../../src/database/entities/notification.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { TaskReminderSentEntity } from "../../src/database/entities/task-reminder-sent.entity";
import { DueDateReminders } from "../../src/scheduler/due-date-reminders.service";
import { DUE_DATE_DURATION_MS } from "../../src/scheduler/reminder-timing";
import { UserNotificationPreferenceEntity } from "../../src/database/entities/user-notification-preference.entity";
import { UserNotificationWorkspaceRuleEntity } from "../../src/database/entities/user-notification-workspace-rule.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import { NotificationCreationService } from "../../src/notification/notification-creation.service";
import { NotificationInboxService } from "../../src/notification/notification-inbox.service";
import { NotificationQueryService } from "../../src/notification/notification-query.service";
import { NotificationDeliveryService } from "../../src/notification-preferences/delivery/notification-delivery.service";
import { NotificationMailer } from "../../src/notification-preferences/delivery/notification-mailer";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("notification recipient boundaries", () => {
  const mailer = { sendNotificationEmail: vi.fn(async () => undefined) };
  const published: string[] = [];
  let app: TestApp;
  let creation: NotificationCreationService;
  let delivery: NotificationDeliveryService;
  let query: NotificationQueryService;
  let inbox: NotificationInboxService;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[NotificationMailer, mailer]] });
    creation = app.get(NotificationCreationService);
    delivery = app.get(NotificationDeliveryService);
    query = app.get(NotificationQueryService);
    inbox = app.get(NotificationInboxService);
    app.get(EventBus).subscribe("notification.created", async () => {
      published.push("notification.created");
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    mailer.sendNotificationEmail.mockClear();
    published.length = 0;
    // Background delivery from createNotification must not race the
    // assertions below; tests restore it before delivering themselves.
    vi.spyOn(delivery, "deliverNotification").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function fixture() {
    const actor = await createWorkspaceMember(app.db);
    const outsider = await createWorkspaceMember(app.db);
    const member = await createWorkspaceMember(app.db);
    await addWorkspaceMember(app.db, actor.workspace.id, member.user.id);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: actor.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      columnId: columns.todo.id,
      title: "Private task",
      userId: member.user.id,
    });
    return { actor, outsider, member, project, task };
  }

  it.skip("filters outsider and nonexistent comment mentions without failing the comment (needs comment creation, which is not ported yet)", () => {});

  it.skip("filters description mentions at the shared creation boundary (needs the task description route, which is not ported yet)", () => {});

  it.skip("does not notify a stale assignee about comments (needs comment creation, which is not ported yet; the due-date half is below)", () => {});

  it("does not notify a stale assignee about due dates", async () => {
    const { actor, member, task } = await fixture();
    await app.db.delete(WorkspaceUserEntity, {
      userId: member.user.id,
      workspaceId: actor.workspace.id,
    });
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { dueDate: new Date(Date.now() - DUE_DATE_DURATION_MS - 60_000) },
    );

    await app.get(DueDateReminders).checkDueDateReminders();

    expect(await app.db.find(NotificationEntity)).toEqual([]);
    expect(await app.db.find(TaskReminderSentEntity)).toEqual([]);
    expect(mailer.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it("keeps reminders working for current assignees", async () => {
    const { member, task } = await fixture();
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { dueDate: new Date(Date.now() - DUE_DATE_DURATION_MS - 60_000) },
    );

    await app.get(DueDateReminders).checkDueDateReminders();

    expect(
      await app.db.find(NotificationEntity, {
        where: { userId: member.user.id },
      }),
    ).toEqual([
      expect.objectContaining({ type: "task_overdue", resourceId: task.id }),
    ]);
  });

  it.skip("rejects foreign assignees while preserving valid partial imports (needs the task routes, which are not ported yet)", () => {});

  it("treats foreign, missing and unsupported references identically and never enriches historical forged references", async () => {
    const { outsider, member, task } = await fixture();
    for (const id of [task.id, "missing"]) {
      expect(
        await creation.createNotification({
          userId: outsider.user.id,
          resourceType: "task",
          resourceId: id,
        }),
      ).toBeNull();
      await insertRow(app.db, NotificationEntity, {
        userId: outsider.user.id,
        resourceType: "task",
        resourceId: id,
        eventData: { taskTitle: "old leaked title" },
      });
    }
    expect(
      await creation.createNotification({
        userId: member.user.id,
        resourceType: "unsupported",
        resourceId: task.id,
      }),
    ).toBeNull();
    expect(await query.getNotifications(outsider.user.id)).toEqual([]);
    expect(published).toEqual([]);
    expect(
      await creation.createNotification({
        userId: member.user.id,
        title: "Generic message",
      }),
    ).toHaveProperty("title", "Generic message");
  });

  it("hides historical contents from list, read response and external delivery after removal", async () => {
    const { actor, member, task } = await fixture();
    const notification = await creation.createNotification({
      userId: member.user.id,
      resourceType: "task",
      resourceId: task.id,
      type: "task_comment",
      eventData: { taskTitle: task.title },
    });
    if (!notification) throw new Error("Expected member notification");
    expect(await query.getNotifications(member.user.id)).toEqual([
      expect.objectContaining({
        id: notification.id,
        eventData: expect.objectContaining({ workspaceId: actor.workspace.id }),
      }),
    ]);
    vi.mocked(delivery.deliverNotification).mockRestore();
    await insertRow(app.db, UserNotificationPreferenceEntity, {
      userId: member.user.id,
      emailEnabled: true,
    });
    await insertRow(app.db, UserNotificationWorkspaceRuleEntity, {
      userId: member.user.id,
      workspaceId: actor.workspace.id,
      isActive: true,
      emailEnabled: true,
    });
    await delivery.deliverNotification(notification.id);
    expect(mailer.sendNotificationEmail).toHaveBeenCalledTimes(1);
    await app.db.delete(WorkspaceUserEntity, {
      userId: member.user.id,
      workspaceId: actor.workspace.id,
    });
    expect(await query.getNotifications(member.user.id)).toEqual([]);
    await expect(
      inbox.markNotificationAsRead(notification.id, member.user.id),
    ).rejects.toMatchObject({ status: 404 });
    await delivery.deliverNotification(notification.id);
    expect(mailer.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("uses bounded non-redirecting requests and safe errors for all external channels", async () => {
    const { actor, member, task } = await fixture();
    const notification = await insertRow(app.db, NotificationEntity, {
      userId: member.user.id,
      resourceType: "task",
      resourceId: task.id,
      type: "task_comment",
    });
    await insertRow(app.db, UserNotificationPreferenceEntity, {
      userId: member.user.id,
      ntfyEnabled: true,
      ntfyServerUrl: "http://127.0.0.1",
      ntfyTopic: "topic",
      ntfyToken: "ntfy-secret",
      gotifyEnabled: true,
      gotifyServerUrl: "http://127.0.0.1",
      gotifyToken: "gotify-secret",
      webhookEnabled: true,
      webhookUrl: "http://127.0.0.1/private-url?key=secret",
      webhookSecret: "webhook-secret",
    });
    await insertRow(app.db, UserNotificationWorkspaceRuleEntity, {
      userId: member.user.id,
      workspaceId: actor.workspace.id,
      ntfyEnabled: true,
      gotifyEnabled: true,
      webhookEnabled: true,
    });
    vi.mocked(delivery.deliverNotification).mockRestore();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        new Error("gotify-secret ntfy-secret webhook-secret private-url"),
      );
    vi.stubGlobal("fetch", fetchMock);
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    await delivery.deliverNotification(notification.id);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(log).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of [
      "gotify-secret",
      "ntfy-secret",
      "webhook-secret",
      "private-url",
    ])
      expect(logged).not.toContain(secret);
    expect(logged).toContain("network");
  });
});
