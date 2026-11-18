import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: labels", () => {
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

  it("rejects unauthenticated label creation", async () => {
    app.auth.signOut();

    const response = await app.request("/api/label", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Bug",
        color: "#ff0000",
        workspaceId: "workspace-missing",
      }),
    });

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("creates a label in a workspace for a member", async () => {
    const member = await createWorkspaceMember(app.db);
    app.auth.signIn(member.user);

    const response = await app.request("/api/label", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Bug",
        color: "#ef4444",
        workspaceId: member.workspace.id,
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as LabelEntity;

    expect(payload).toMatchObject({
      workspaceId: member.workspace.id,
      name: "Bug",
      color: "#ef4444",
    });

    const persisted = await app.db.findOne(LabelEntity, {
      where: { id: payload.id },
    });

    expect(persisted).toMatchObject({
      id: payload.id,
      workspaceId: member.workspace.id,
      name: "Bug",
      color: "#ef4444",
    });
  });

  it("rejects label creation for users outside the workspace", async () => {
    const member = await createWorkspaceMember(app.db);
    const outsider = await createUser(app.db, {
      id: "user-label-outsider",
      name: "Label Outsider",
    });

    app.auth.signIn(outsider);

    const response = await app.request("/api/label", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Blocked",
        color: "#6b7280",
        workspaceId: member.workspace.id,
      }),
    });

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Workspace not found",
      code: "NOT_FOUND",
    });

    const persisted = await app.db.findOne(LabelEntity, {
      where: { name: "Blocked" },
    });

    expect(persisted).toBeNull();
  });

  describe("deletion cascade", () => {
    it("deletes task-level copies when a workspace label is deleted", async () => {
      const member = await createWorkspaceMember(app.db);
      const { project, columns } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });

      const taskA = await createTask(app.db, {
        projectId: project.id,
        userId: member.user.id,
        title: "Task A",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      });

      const taskB = await createTask(app.db, {
        projectId: project.id,
        userId: member.user.id,
        title: "Task B",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 2,
        position: 2,
      });

      const workspaceLabel = await createLabel(app.db, {
        name: "Bug",
        color: "#ef4444",
        workspaceId: member.workspace.id,
        taskId: null,
      });

      // Task-level copies, as assigning the label to tasks creates them.
      await createLabel(app.db, {
        name: "Bug",
        color: "#ef4444",
        workspaceId: member.workspace.id,
        taskId: taskA.id,
      });

      await createLabel(app.db, {
        name: "Bug",
        color: "#ef4444",
        workspaceId: member.workspace.id,
        taskId: taskB.id,
      });

      const before = await app.db.find(LabelEntity, {
        where: { workspaceId: member.workspace.id },
      });
      expect(before).toHaveLength(3);

      app.auth.signIn(member.user);

      const response = await app.request(`/api/label/${workspaceLabel.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);

      const remaining = await app.db.find(LabelEntity, {
        where: { workspaceId: member.workspace.id },
      });
      expect(remaining).toHaveLength(0);
    });

    it("does not affect unrelated labels when deleting a workspace label", async () => {
      const member = await createWorkspaceMember(app.db);
      const { project, columns } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });

      const task = await createTask(app.db, {
        projectId: project.id,
        userId: member.user.id,
        title: "Task",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      });

      const labelBug = await createLabel(app.db, {
        name: "Bug",
        color: "#ef4444",
        workspaceId: member.workspace.id,
        taskId: null,
      });

      const labelFeature = await createLabel(app.db, {
        name: "Feature",
        color: "#3b82f6",
        workspaceId: member.workspace.id,
        taskId: null,
      });

      await createLabel(app.db, {
        name: "Bug",
        color: "#ef4444",
        workspaceId: member.workspace.id,
        taskId: task.id,
      });

      const featureCopy = await createLabel(app.db, {
        name: "Feature",
        color: "#3b82f6",
        workspaceId: member.workspace.id,
        taskId: task.id,
      });

      app.auth.signIn(member.user);

      const response = await app.request(`/api/label/${labelBug.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);

      const featureWorkspace = await app.db.findOne(LabelEntity, {
        where: { id: labelFeature.id },
      });
      expect(featureWorkspace).not.toBeNull();

      const featureTaskCopy = await app.db.findOne(LabelEntity, {
        where: { id: featureCopy.id },
      });
      expect(featureTaskCopy).not.toBeNull();
    });
  });
});
