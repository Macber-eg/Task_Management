import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: task creation", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    app.auth.signOut();
  });

  function createTaskRequest(projectId: string, body: Record<string, unknown>) {
    return app.request(`/api/task/${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function findTask(projectId: string, title: string) {
    return app.db.findOne(TaskEntity, { where: { projectId, title } });
  }

  it("rejects unauthenticated task creation requests", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    const response = await createTaskRequest(project.id, {
      title: "Unauthorized task",
      description: "Should not be created",
      priority: "low",
      status: "to-do",
    });

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("creates a task with the matching column, assignee, and next number", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Delivery",
      slug: "delivery",
    });

    await createTask(app.db, {
      projectId: project.id,
      userId: member.user.id,
      title: "Existing task",
      description: "Already there",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });
    await app.db.update(
      ProjectEntity,
      { id: project.id },
      { lastTaskNumber: 1 },
    );

    app.auth.signIn(member.user);
    const response = await createTaskRequest(project.id, {
      title: "Ship integration flow",
      description: "Cover the first create-task path",
      priority: "high",
      status: "to-do",
      userId: member.user.id,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string };

    expect(payload).toMatchObject({
      projectId: project.id,
      title: "Ship integration flow",
      description: "Cover the first create-task path",
      priority: "high",
      status: "to-do",
      userId: member.user.id,
      number: 2,
      position: 2,
      assigneeName: member.user.name,
    });

    const persistedTask = await app.db.findOne(TaskEntity, {
      where: { id: payload.id },
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      projectId: project.id,
      columnId: columns.todo.id,
      userId: member.user.id,
      title: "Ship integration flow",
      priority: "high",
      status: "to-do",
      number: 2,
      position: 2,
    });
  });

  it("rejects task creation for users outside the project workspace", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const outsider = await createUser(app.db, { name: "Task Outsider" });

    app.auth.signIn(outsider);
    const response = await createTaskRequest(project.id, {
      title: "Forbidden task",
      description: "Should not be created",
      priority: "low",
      status: "to-do",
    });

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Project not found",
      code: "NOT_FOUND",
    });
    expect(await findTask(project.id, "Forbidden task")).toBeNull();
  });

  it("creates an unassigned task with parsed dates when optional fields are provided", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);
    const response = await createTaskRequest(project.id, {
      title: "Plan release cut",
      description: "Track optional fields too",
      priority: "medium",
      status: "in-progress",
      startDate: "2026-04-01T09:00:00.000Z",
      dueDate: "2026-04-05T17:00:00.000Z",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      assigneeName?: string;
    };

    expect(payload).toMatchObject({
      userId: null,
      columnId: columns.inProgress.id,
      startDate: "2026-04-01T09:00:00.000Z",
      dueDate: "2026-04-05T17:00:00.000Z",
    });
    expect(payload.assigneeName).toBeUndefined();

    const persistedTask = await app.db.findOne(TaskEntity, {
      where: { id: payload.id },
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      userId: null,
      columnId: columns.inProgress.id,
      status: "in-progress",
    });
    expect(persistedTask?.startDate?.toISOString()).toBe(
      "2026-04-01T09:00:00.000Z",
    );
    expect(persistedTask?.dueDate?.toISOString()).toBe(
      "2026-04-05T17:00:00.000Z",
    );
  });

  it("creates tasks without a column when the status has no matching project column", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);
    const response = await createTaskRequest(project.id, {
      title: "Future status task",
      description: "Status does not map to a seeded column",
      priority: "low",
      status: "planned",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string };

    expect(payload).toMatchObject({
      status: "planned",
      columnId: null,
      position: 1,
    });

    const persistedTask = await app.db.findOne(TaskEntity, {
      where: { id: payload.id },
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      status: "planned",
      columnId: null,
      position: 1,
    });
  });

  it("rejects task creation for an assignee that cannot be assigned, without revealing whether the user exists", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);
    const response = await createTaskRequest(project.id, {
      title: "Ghost assignee task",
      description: "Should fail because the assignee does not exist",
      priority: "low",
      status: "to-do",
      userId: `user-${randomUUID()}`,
    });

    // A missing user and a non-member both answer 403 with the same message, so
    // the endpoint cannot be used to probe which user ids exist.
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain(
      "Assignee is not a member of this workspace",
    );
    expect(await findTask(project.id, "Ghost assignee task")).toBeNull();
  });

  it("creates a task when the assignee userId is surrounded by whitespace", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);
    const response = await createTaskRequest(project.id, {
      title: "Padded assignee task",
      description: "Whitespace around userId should be trimmed",
      priority: "medium",
      status: "to-do",
      userId: `  ${member.user.id}  `,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      userId: string;
      assigneeName?: string;
    };

    expect(payload.userId).toBe(member.user.id);
    expect(payload.assigneeName).toBe(member.user.name);

    const persistedTask = await app.db.findOne(TaskEntity, {
      where: { id: payload.id },
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      projectId: project.id,
      columnId: columns.todo.id,
      userId: member.user.id,
      title: "Padded assignee task",
    });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
  ])(
    "creates an unassigned task when the assignee userId is %s",
    async (label, userId) => {
      const member = await createWorkspaceMember(app.db);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });

      app.auth.signIn(member.user);
      const title = `Blank assignee task (${label})`;
      const response = await createTaskRequest(project.id, {
        title,
        description: "Blank userId means unassigned",
        priority: "low",
        status: "to-do",
        userId,
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        userId: string | null;
        assigneeName?: string;
      };

      expect(payload.userId).toBeNull();
      expect(payload.assigneeName).toBeUndefined();
      expect((await findTask(project.id, title))?.userId).toBeNull();
    },
  );
});
