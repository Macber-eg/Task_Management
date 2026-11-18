import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { EventBus } from "../../src/events/event-bus";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { restrictToProjects } from "../support/fixtures/restrict-to-projects";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: task activity", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  async function seededTask(role = "owner") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Seeded",
      description: "",
      priority: "low",
      status: "to-do",
      columnId: columns.todo.id,
      number: 1,
      position: 1,
    });
    return { ...member, project, task };
  }

  // From the previous authorization-boundaries suite.
  it("credits the session user, not a userId supplied in the body", async () => {
    const { user, task } = await seededTask();
    const impersonated = await createWorkspaceMember(app.db, { role: "owner" });
    app.auth.signIn(user);

    const response = await app.request("/api/activity/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        userId: impersonated.user.id,
        message: "note-1",
        type: "created",
      }),
    });

    expect(response.status).toBe(200);
    const activity = (await response.json()) as Record<string, unknown>;
    expect(activity.userId).toBe(user.id);
    expect(activity.userId).not.toBe(impersonated.user.id);
    expect(activity).toMatchObject({
      taskId: task.id,
      type: "created",
      content: "note-1",
      eventData: null,
      externalUserName: null,
    });
  });

  it("lists a task's feed newest first and collapses blank lines in system events", async () => {
    const { user, task } = await seededTask();
    const old = await insertRow(app.db, ActivityEntity, {
      taskId: task.id,
      type: "description_changed",
      content: "first\n\n\nsecond",
      createdAt: new Date(Date.now() - 1000),
    });
    const comment = await insertRow(app.db, ActivityEntity, {
      taskId: task.id,
      type: "comment",
      userId: user.id,
      content: "keep\n\n\nspacing",
    });
    app.auth.signIn(user);

    const response = await app.request(`/api/activity/${task.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: comment.id,
        taskId: task.id,
        type: "comment",
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        userId: user.id,
        content: "keep\n\n\nspacing",
        eventData: null,
        externalUserName: null,
        externalUserAvatar: null,
        externalSource: null,
        externalUrl: null,
      },
      expect.objectContaining({ id: old.id, content: "first\nsecond" }),
    ]);
  });

  it("only lets the author edit or delete a comment, through either API", async () => {
    const { user, workspace, task } = await seededTask();
    const other = await createUser(app.db);
    await addWorkspaceMember(app.db, workspace.id, other.id, "admin");
    const events: { type: string; data: Record<string, unknown> }[] = [];
    for (const type of [
      "comment.created",
      "comment.updated",
      "comment.deleted",
    ])
      app
        .get(EventBus)
        .subscribe<Record<string, unknown>>(type, async (data) => {
          events.push({ type, data });
        });
    app.auth.signIn(user);

    const created = await app.request(`/api/comment/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Mine" }),
    });
    const { id } = (await created.json()) as { id: string };

    app.auth.signIn(other);
    const foreignEdit = await app.request(`/api/comment/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hijacked" }),
    });
    expect(foreignEdit.status).toBe(404);
    expect(await readErrorBody(foreignEdit)).toEqual({
      message: "Comment not found or you are not the author",
      code: "NOT_FOUND",
    });
    const foreignDelete = await app.request("/api/activity/comment", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activityId: id }),
    });
    expect(foreignDelete.status).toBe(404);

    app.auth.signIn(user);
    const edited = await app.request("/api/activity/comment", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activityId: id, comment: "Edited" }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ id, content: "Edited" });

    const deleted = await app.request(`/api/comment/${id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ id, content: "Edited" });
    expect(await app.db.find(ActivityEntity)).toEqual([]);

    expect(events.map((event) => event.type)).toEqual([
      "comment.created",
      "comment.updated",
      "comment.deleted",
    ]);
    expect(events[0]?.data).toMatchObject({
      id,
      comment: `**${user.name}** commented:\n> Mine`,
      projectId: task.projectId,
    });
    expect(events[1]?.data).toMatchObject({
      id,
      content: "Edited",
      projectId: task.projectId,
      userId: user.id,
    });
  });

  it("answers 404 for a comment id that is not a comment", async () => {
    const { user, task } = await seededTask();
    const event = await insertRow(app.db, ActivityEntity, {
      taskId: task.id,
      type: "status_changed",
      userId: user.id,
    });
    app.auth.signIn(user);

    const response = await app.request(`/api/comment/${event.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toEqual({
      message: "Comment not found",
      code: "NOT_FOUND",
    });
  });

  it("writes the activity feed from task events", async () => {
    const { user, task } = await seededTask();
    const events = app.get(EventBus);
    const base = { taskId: task.id, userId: user.id, title: task.title };
    const wait = { waitForHandlers: true };

    await events.publish(
      "task.created",
      {
        taskId: task.id,
        currentUserId: user.id,
        type: "create",
        content: null,
      },
      wait,
    );
    await events.publish(
      "task.created",
      { taskId: task.id, type: "create", content: null },
      wait,
    );
    await events.publish(
      "task.moved",
      {
        ...base,
        type: "moved",
        fromProjectId: "p1",
        fromProjectName: "One",
        toProjectId: "p2",
        toProjectName: "Two",
        oldStatus: "to-do",
        newStatus: "done",
      },
      wait,
    );
    await events.publish(
      "task.status_changed",
      { ...base, type: "status_changed", oldStatus: "a", newStatus: "b" },
      wait,
    );
    await events.publish(
      "task.priority_changed",
      {
        ...base,
        type: "priority_changed",
        oldPriority: "low",
        newPriority: "high",
      },
      wait,
    );
    await events.publish(
      "task.unassigned",
      { ...base, type: "unassigned" },
      wait,
    );
    await events.publish(
      "task.assignee_changed",
      {
        ...base,
        type: "assignee_changed",
        oldAssignee: null,
        newAssignee: "Me",
        newAssigneeId: user.id,
      },
      wait,
    );
    await events.publish(
      "task.due_date_changed",
      {
        ...base,
        type: "due_date_changed",
        oldDueDate: null,
        newDueDate: new Date("2026-01-02T03:04:05.000Z"),
      },
      wait,
    );

    const rows = await app.db.find(ActivityEntity, {
      order: { createdAt: "ASC" },
    });
    expect(
      rows.map(({ type, userId, content, eventData }) => ({
        type,
        userId,
        content,
        eventData,
      })),
    ).toEqual([
      { type: "create", userId: user.id, content: null, eventData: {} },
      {
        type: "moved",
        userId: user.id,
        content: null,
        eventData: {
          fromProjectId: "p1",
          fromProjectName: "One",
          toProjectId: "p2",
          toProjectName: "Two",
          oldStatus: "to-do",
          newStatus: "done",
        },
      },
      {
        type: "status_changed",
        userId: user.id,
        content: null,
        eventData: { oldStatus: "a", newStatus: "b" },
      },
      {
        type: "priority_changed",
        userId: user.id,
        content: null,
        eventData: { oldPriority: "low", newPriority: "high" },
      },
      { type: "unassigned", userId: user.id, content: null, eventData: {} },
      {
        type: "assignee_changed",
        userId: user.id,
        content: null,
        eventData: {
          newAssigneeId: user.id,
          newAssignee: "Me",
          isSelfAssigned: true,
        },
      },
      {
        type: "due_date_changed",
        userId: user.id,
        content: null,
        eventData: {
          oldDueDate: null,
          newDueDate: "2026-01-02T03:04:05.000Z",
        },
      },
    ]);
  });

  // From the previous project-access suite, with the move seeded directly
  // instead of made through the task move route.
  it("hides the source project of a move from members who can't see it", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const betaOnly = await createUser(app.db);
    await addWorkspaceMember(app.db, ctx.workspace.id, betaOnly.id);
    await restrictToProjects(app.db, ctx.workspace.id, betaOnly.id, [
      ctx.beta.id,
    ]);
    await insertRow(app.db, ActivityEntity, {
      taskId: ctx.betaTask.id,
      type: "moved",
      userId: ctx.owner.id,
      eventData: {
        fromProjectId: ctx.alpha.id,
        fromProjectName: "Alpha",
        toProjectId: ctx.beta.id,
        toProjectName: "Beta",
        oldStatus: "to-do",
        newStatus: "to-do",
      },
    });

    app.auth.signIn(betaOnly);
    const response = await app.request(`/api/activity/${ctx.betaTask.id}`);
    const activities = (await response.json()) as {
      type: string;
      eventData: Record<string, unknown> | null;
    }[];
    expect(
      activities.find((activity) => activity.type === "moved")?.eventData,
    ).toMatchObject({
      fromProjectId: null,
      fromProjectName: null,
      toProjectId: ctx.beta.id,
      toProjectName: "Beta",
    });

    app.auth.signIn(ctx.owner);
    const owner = await app.request(`/api/activity/${ctx.betaTask.id}`);
    const visible = (await owner.json()) as {
      eventData: Record<string, unknown> | null;
    }[];
    expect(visible[0]?.eventData).toMatchObject({
      fromProjectId: ctx.alpha.id,
      fromProjectName: "Alpha",
    });
  });

  // The previous project-access suite's reads, for this stream's routes.
  it("blocks reads of a project outside the member's selection", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.restricted);

    for (const path of [
      `/api/comment/${ctx.betaTask.id}`,
      `/api/activity/${ctx.betaTask.id}`,
      `/api/task-relation/${ctx.betaTask.id}`,
      `/api/custom-field/project/${ctx.beta.id}`,
      `/api/external-link/task/${ctx.betaTask.id}`,
    ]) {
      expect({ path, status: (await app.request(path)).status }).toEqual({
        path,
        status: 403,
      });
    }

    for (const path of [
      `/api/comment/${ctx.alphaTask.id}`,
      `/api/activity/${ctx.alphaTask.id}`,
      `/api/task-relation/${ctx.alphaTask.id}`,
      `/api/custom-field/project/${ctx.alpha.id}`,
      `/api/external-link/task/${ctx.alphaTask.id}`,
    ]) {
      expect({ path, status: (await app.request(path)).status }).toEqual({
        path,
        status: 200,
      });
    }
  });
});
