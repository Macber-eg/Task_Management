import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NotificationEntity } from "../../src/database/entities/notification.entity";
import { UserNotificationPreferenceEntity } from "../../src/database/entities/user-notification-preference.entity";
import { EventBus } from "../../src/events/event-bus";
import { NotificationDeliveryService } from "../../src/notification-preferences/delivery/notification-delivery.service";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite covered these routes only through their controllers;
// these pin the HTTP wiring, the event and the server-raised notifications.
describe("API integration: notification routes", () => {
  const created: unknown[] = [];
  let app: TestApp;

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    app.get(EventBus).subscribe("notification.created", async (data) => {
      created.push(data);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    created.length = 0;
    vi.restoreAllMocks();
    vi.spyOn(
      app.get(NotificationDeliveryService),
      "deliverNotification",
    ).mockResolvedValue();
  });

  it("creates a notification for the caller and announces it", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);

    const response = await app.request(
      "/api/notification",
      json("POST", {
        title: "Build finished",
        message: "All green",
        type: "info",
        eventData: { run: 7 },
        relatedEntityId: workspace.id,
        relatedEntityType: "workspace",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      userId: user.id,
      title: "Build finished",
      content: "All green",
      type: "info",
      eventData: { run: 7 },
      isRead: false,
      resourceId: workspace.id,
      resourceType: "workspace",
    });
    expect(created).toEqual([
      { notificationId: body.id, userId: user.id, initiatorId: user.id },
    ]);
    expect(
      app.get(NotificationDeliveryService).deliverNotification,
    ).toHaveBeenCalledWith(body.id);
  });

  it("answers null when the caller muted the category", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    await insertRow(app.db, UserNotificationPreferenceEntity, {
      userId: user.id,
      taskCommentEnabled: false,
    });
    app.auth.signIn(user);

    const response = await app.request(
      "/api/notification",
      json("POST", {
        type: "task_comment",
        relatedEntityId: task.id,
        relatedEntityType: "task",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("null");
    expect(await app.db.count(NotificationEntity)).toBe(0);
    expect(created).toEqual([]);
  });

  it("rejects a body without a type", async () => {
    const { user } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);
    const response = await app.request(
      "/api/notification",
      json("POST", { title: "x" }),
    );
    expect(response.status).toBe(400);
  });

  it("marks one of the caller's notifications read and hides others'", async () => {
    const { user } = await createWorkspaceMember(app.db);
    const { user: other } = await createWorkspaceMember(app.db);
    const mine = await insertRow(app.db, NotificationEntity, {
      userId: user.id,
      title: "Mine",
    });
    const theirs = await insertRow(app.db, NotificationEntity, {
      userId: other.id,
      title: "Theirs",
    });
    app.auth.signIn(user);

    const response = await app.request(`/api/notification/${mine.id}/read`, {
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: mine.id, isRead: true });
    expect(new Date(body.updatedAt as string).getTime()).toBeGreaterThan(
      mine.updatedAt.getTime() - 1,
    );

    const foreign = await app.request(`/api/notification/${theirs.id}/read`, {
      method: "PATCH",
    });
    expect(foreign.status).toBe(404);
    expect(await readErrorBody(foreign)).toEqual({
      message: "Notification not found",
      code: "NOT_FOUND",
    });
    const stored = await app.db.findOneByOrFail(NotificationEntity, {
      id: theirs.id,
    });
    expect(stored.isRead).toBe(false);
  });

  it("hides notifications about tasks in other projects", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    await insertRow(app.db, NotificationEntity, {
      userId: ctx.restricted.id,
      resourceType: "task",
      resourceId: ctx.alphaTask.id,
      eventData: { taskTitle: "Visible alpha task" },
    });
    await insertRow(app.db, NotificationEntity, {
      userId: ctx.restricted.id,
      resourceType: "task",
      resourceId: ctx.betaTask.id,
      eventData: { taskTitle: "Hidden beta task" },
    });
    app.auth.signIn(ctx.restricted);

    const response = await app.request("/api/notification");

    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("Visible alpha task");
    expect(body).not.toContain("Hidden beta task");
  });

  describe("server-raised notifications", () => {
    async function context() {
      const { user: actor, workspace } = await createWorkspaceMember(app.db);
      const { user: assignee } = await createWorkspaceMember(app.db);
      await addWorkspaceMember(app.db, workspace.id, assignee.id);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      const task = await createTask(app.db, {
        projectId: project.id,
        title: "Ship it",
        userId: assignee.id,
      });
      return { actor, assignee, workspace, project, task };
    }

    async function publish(type: string, data: unknown) {
      await app
        .get(EventBus)
        .publish(type, data, { waitForHandlers: true });
      return app.db.find(NotificationEntity);
    }

    it("notifies a task's assignee about a new task, unless they created it", async () => {
      const { actor, assignee, workspace, project, task } = await context();
      expect(
        await publish("task.created", {
          taskId: task.id,
          userId: assignee.id,
          currentUserId: assignee.id,
          title: task.title,
          projectId: project.id,
          type: "created",
        }),
      ).toEqual([]);

      const [notification] = await publish("task.created", {
        taskId: task.id,
        userId: assignee.id,
        currentUserId: actor.id,
        title: task.title,
        projectId: project.id,
        type: "created",
      });
      expect(notification).toMatchObject({
        userId: assignee.id,
        type: "task_created",
        eventData: {
          taskTitle: "Ship it",
          projectId: project.id,
          workspaceId: workspace.id,
        },
        resourceId: task.id,
        resourceType: "task",
        title: null,
        content: null,
      });
    });

    it("notifies a workspace's owner when it is created", async () => {
      const { actor, workspace } = await context();
      const [notification] = await publish("workspace.created", {
        workspaceId: workspace.id,
        workspaceName: "Acme",
        ownerEmail: actor.email,
        ownerId: actor.id,
      });
      expect(notification).toMatchObject({
        userId: actor.id,
        type: "workspace_created",
        eventData: { workspaceName: "Acme" },
        resourceId: workspace.id,
        resourceType: "workspace",
      });
    });

    it("notifies the assignee of status and assignee changes made by others", async () => {
      const { actor, assignee, workspace, project, task } = await context();
      expect(
        await publish("task.status_changed", {
          taskId: task.id,
          userId: assignee.id,
          oldStatus: "to-do",
          newStatus: "done",
          title: task.title,
          assigneeId: assignee.id,
          type: "status_changed",
        }),
      ).toEqual([]);

      await publish("task.status_changed", {
        taskId: task.id,
        userId: actor.id,
        oldStatus: "to-do",
        newStatus: "done",
        title: task.title,
        assigneeId: assignee.id,
        type: "status_changed",
      });
      await publish("task.assignee_changed", {
        taskId: task.id,
        userId: actor.id,
        oldAssignee: null,
        newAssignee: assignee.name,
        newAssigneeId: assignee.id,
        type: "assignee_changed",
        title: task.title,
      });

      const notifications = await app.db.find(NotificationEntity, {
        order: { createdAt: "ASC" },
      });
      expect(notifications).toEqual([
        expect.objectContaining({
          userId: assignee.id,
          type: "task_status_changed",
          eventData: {
            taskTitle: "Ship it",
            oldStatus: "to-do",
            newStatus: "done",
            projectId: project.id,
            workspaceId: workspace.id,
          },
        }),
        expect.objectContaining({
          userId: assignee.id,
          type: "task_assignee_changed",
          eventData: {
            taskTitle: "Ship it",
            projectId: project.id,
            workspaceId: workspace.id,
          },
        }),
      ]);
    });

    it("respects muted categories for server-raised notifications", async () => {
      const { actor, assignee, task } = await context();
      await insertRow(app.db, UserNotificationPreferenceEntity, {
        userId: assignee.id,
        taskStatusChangeEnabled: false,
      });
      expect(
        await publish("task.status_changed", {
          taskId: task.id,
          userId: actor.id,
          oldStatus: "to-do",
          newStatus: "done",
          title: task.title,
          assigneeId: assignee.id,
          type: "status_changed",
        }),
      ).toEqual([]);
    });
  });
});
