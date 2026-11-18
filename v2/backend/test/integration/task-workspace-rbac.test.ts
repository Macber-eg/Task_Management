import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { In } from "typeorm";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { WorkspaceRoleEntity } from "../../src/database/entities/workspace-role.entity";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { insertRow } from "../support/fixtures/insert-row";
import { createUnseededWorkspaceMember } from "../support/fixtures/task-d-unseeded-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from the previous `workspace-rbac` suite: the task routes. Its
// project, column, label and workspace cases belong to those features.
// Workspaces start without stored role rows, as in the previous suite, so
// the compiled-in roles apply unless a test stores its own.
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

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function seedTask(
  projectId: string,
  columnId: string | null,
  userId?: string,
  status = "to-do",
) {
  return createTask(app.db, {
    projectId,
    title: "Seeded task",
    description: "Existing",
    priority: "medium",
    status,
    columnId,
    number: 1,
    position: 1,
    ...(userId ? { userId } : {}),
  });
}

function createWorkspaceRoleRow(
  workspaceId: string,
  role: string,
  permission: Record<string, string[]> | string,
) {
  return insertRow(app.db, WorkspaceRoleEntity, {
    workspaceId,
    role,
    permission:
      typeof permission === "string" ? permission : JSON.stringify(permission),
  });
}

function postCreateTask(projectId: string) {
  return app.request(
    `/api/task/${projectId}`,
    json("POST", {
      title: "RBAC probe",
      description: "",
      priority: "low",
      status: "to-do",
    }),
  );
}

function findTask(id: string) {
  return app.db.findOne(TaskEntity, { where: { id } });
}

function bulk(body: unknown) {
  return app.request("/api/task/bulk", json("PATCH", body));
}

async function memberWithProject(role: string) {
  const member = await createUnseededWorkspaceMember(app.db, role);
  const { project, columns } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  app.auth.signIn(member.user);
  return { ...member, project, columns };
}

describe("API integration: workspace RBAC enforcement on tasks", () => {
  describe("built-in roles", () => {
    it("allows a member to create a task (member role grants task:create)", async () => {
      const { project } = await memberWithProject("member");

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(200);
    });

    it("blocks a viewer from creating a task (viewer role lacks task:create)", async () => {
      const { project } = await memberWithProject("viewer");

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(403);
      expect(await readErrorBody(response)).toEqual({
        message: "Insufficient permissions",
        code: "MISSING_PERMISSION",
        missingPermissions: ["task:create"],
      });

      const persisted = await app.db.findOne(TaskEntity, {
        where: { projectId: project.id, title: "RBAC probe" },
      });
      expect(persisted).toBeNull();
    });

    it("blocks a member from deleting a task (member role lacks task:delete)", async () => {
      const { project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await app.request(`/api/task/${task.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);
      expect(await findTask(task.id)).not.toBeNull();
    });

    it("allows an admin to delete a task (admin role grants task:delete)", async () => {
      const { project, columns } = await memberWithProject("admin");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await app.request(`/api/task/${task.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      expect(await findTask(task.id)).toBeNull();
    });

    it.each([
      ["To Do", "to-do", "todo"],
      ["In Progress", "in-progress", "inProgress"],
      ["In Review", "in-review", "inReview"],
      ["Done", "done", "done"],
    ] as const)(
      "allows an owner to delete a task from %s",
      async (_label, status, columnKey) => {
        const { project, columns } = await memberWithProject("owner");
        const task = await seedTask(
          project.id,
          columns[columnKey].id,
          undefined,
          status,
        );

        const response = await app.request(`/api/task/${task.id}`, {
          method: "DELETE",
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          id: task.id,
          status,
        });
        expect(await findTask(task.id)).toBeNull();
      },
    );

    it("returns 404 when the user has no row in workspace_member for the workspace", async () => {
      const member = await createUnseededWorkspaceMember(app.db, "admin");
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const outsider = await createUser(app.db, { name: "Outsider" });

      app.auth.signIn(outsider);
      const response = await postCreateTask(project.id);
      // The workspace access rule runs first and rejects with its own message.
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("Project not found");
    });

    it("does not authorize a project through a conflicting workspaceId query", async () => {
      const attacker = await createUnseededWorkspaceMember(app.db, "admin");
      const victim = await createUnseededWorkspaceMember(app.db, "admin");
      const { project } = await createProjectFixture(app.db, {
        workspaceId: victim.workspace.id,
      });

      app.auth.signIn(attacker.user);
      const response = await app.request(
        `/api/task/${project.id}?workspaceId=${attacker.workspace.id}`,
        json("POST", {
          title: "Cross-workspace probe",
          description: "",
          priority: "low",
          status: "to-do",
        }),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("bulk task mutations", () => {
    it("blocks a viewer from changing task priority in bulk", async () => {
      const { project, columns } = await memberWithProject("viewer");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await bulk({
        taskIds: [task.id],
        operation: "updatePriority",
        value: "high",
      });
      expect(response.status).toBe(403);
      expect((await findTask(task.id))?.priority).toBe("medium");
    });

    it("allows a member to change task priority in bulk", async () => {
      const { project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await bulk({
        taskIds: [task.id],
        operation: "updatePriority",
        value: "high",
      });
      expect(response.status).toBe(200);
      expect((await findTask(task.id))?.priority).toBe("high");
    });

    it("preserves the not-found response for unknown tasks", async () => {
      const member = await createUnseededWorkspaceMember(app.db, "member");
      app.auth.signIn(member.user);

      const response = await bulk({
        taskIds: [randomUUID()],
        operation: "updatePriority",
        value: "high",
      });
      expect(response.status).toBe(404);
    });

    it("rejects bulk mutations that span workspaces", async () => {
      const { project, columns } = await memberWithProject("member");
      const foreign = await createUnseededWorkspaceMember(app.db, "admin");
      const { project: foreignProject, columns: foreignColumns } =
        await createProjectFixture(app.db, {
          workspaceId: foreign.workspace.id,
        });
      const task = await seedTask(project.id, columns.todo.id);
      const foreignTask = await seedTask(
        foreignProject.id,
        foreignColumns.todo.id,
      );

      const response = await bulk({
        taskIds: [task.id, foreignTask.id],
        operation: "updatePriority",
        value: "high",
      });
      expect(response.status).toBe(400);

      const persistedTasks = await app.db.find(TaskEntity, {
        where: { id: In([task.id, foreignTask.id]) },
      });
      expect(persistedTasks).toHaveLength(2);
      expect(persistedTasks.every((row) => row.priority === "medium")).toBe(
        true,
      );
    });

    it("blocks a member from deleting a task in bulk", async () => {
      const { project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await bulk({ taskIds: [task.id], operation: "delete" });
      expect(response.status).toBe(403);
      expect(await findTask(task.id)).not.toBeNull();
    });

    it("blocks a member from assigning a task in bulk", async () => {
      const { user, project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await bulk({
        taskIds: [task.id],
        operation: "updateAssignee",
        value: user.id,
      });
      expect(response.status).toBe(403);
      expect((await findTask(task.id))?.userId).toBeNull();
    });

    it("allows an admin to assign a task in bulk", async () => {
      const { user, project, columns } = await memberWithProject("admin");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await bulk({
        taskIds: [task.id],
        operation: "updateAssignee",
        value: user.id,
      });
      expect(response.status).toBe(200);
      expect((await findTask(task.id))?.userId).toBe(user.id);
    });

    it("does not copy a label from another workspace in bulk", async () => {
      const { project, columns } = await memberWithProject("member");
      const foreign = await createUnseededWorkspaceMember(app.db, "admin");
      const task = await seedTask(project.id, columns.todo.id);
      const foreignLabel = await createLabel(app.db, {
        name: "private",
        color: "#000000",
        workspaceId: foreign.workspace.id,
      });

      const response = await bulk({
        taskIds: [task.id],
        operation: "addLabel",
        value: foreignLabel.id,
      });
      expect(response.status).toBe(400);

      const copiedLabel = await app.db.findOne(LabelEntity, {
        where: { taskId: task.id, name: foreignLabel.name },
      });
      expect(copiedLabel).toBeNull();
    });
  });

  describe("custom workspace roles", () => {
    async function customRoleMember(role: string) {
      const member = await createUnseededWorkspaceMember(app.db, role);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      app.auth.signIn(member.user);
      return { ...member, project };
    }

    it("blocks a custom role that only grants task:read from creating a task", async () => {
      const { workspace, project } = await customRoleMember("readonly");
      await createWorkspaceRoleRow(workspace.id, "readonly", {
        task: ["read"],
        project: ["read"],
      });

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(403);
    });

    it("allows a custom role that grants task:create to create a task", async () => {
      const { workspace, project } = await customRoleMember("creator");
      await createWorkspaceRoleRow(workspace.id, "creator", {
        task: ["create", "read"],
        project: ["read"],
      });

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(200);
    });

    it("lets a workspace_role row override the built-in viewer permissions", async () => {
      // viewer's compiled-in statements have no task:create. A workspace_role
      // row for "viewer" with task:create should override and grant access.
      const { workspace, project } = await customRoleMember("viewer");
      await createWorkspaceRoleRow(workspace.id, "viewer", {
        task: ["create", "read", "update"],
        project: ["read"],
        workspace: ["read"],
      });

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(200);
    });

    it("returns 403 when the workspace_role permission JSON is malformed", async () => {
      const { workspace, project } = await customRoleMember("broken");
      // With no built-in fallback for "broken", access is denied rather than
      // the request crashing.
      await createWorkspaceRoleRow(workspace.id, "broken", "not-json");

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(403);
    });

    it("drops malformed permission entries instead of throwing", async () => {
      const { workspace, project } = await customRoleMember("partial");
      // Valid string arrays are kept, other entries ignored.
      await createWorkspaceRoleRow(
        workspace.id,
        "partial",
        JSON.stringify({
          task: ["create"],
          project: "not-an-array",
          weird: { nested: true },
        }),
      );

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(200);
    });

    it("allows a member with several roles when any role grants the permission", async () => {
      const { workspace, project } = await customRoleMember("readonly,member");
      await createWorkspaceRoleRow(workspace.id, "readonly", {
        task: ["read"],
      });

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(200);
    });

    it("blocks a member with several roles when no role grants the permission", async () => {
      const { workspace, project } = await customRoleMember("readonly,viewer");
      await createWorkspaceRoleRow(workspace.id, "readonly", {
        task: ["read"],
      });

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(403);
      expect(await readErrorBody(response)).toEqual({
        message: "Insufficient permissions",
        code: "MISSING_PERMISSION",
        missingPermissions: ["task:create"],
      });
    });

    it("allows a role when any duplicate workspace_role row grants the permission", async () => {
      const { workspace, project } = await customRoleMember("creator");
      await createWorkspaceRoleRow(workspace.id, "creator", {
        task: ["read"],
        project: ["read"],
      });
      await createWorkspaceRoleRow(workspace.id, "creator", {
        task: ["create", "read"],
        project: ["read"],
      });

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(200);
    });

    it("falls back to built-in role when no workspace_role row exists for the name", async () => {
      const { project } = await customRoleMember("admin");

      const response = await postCreateTask(project.id);
      expect(response.status).toBe(200);
    });
  });

  describe("resource coverage: task:update", () => {
    function putTask(
      taskId: string,
      projectId: string,
      body: Record<string, unknown>,
    ) {
      return app.request(
        `/api/task/${taskId}`,
        json("PUT", {
          status: "to-do",
          projectId,
          position: 1,
          ...body,
        }),
      );
    }

    it("allows a member to update a task", async () => {
      const { project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await putTask(task.id, project.id, {
        title: "Updated by member",
        description: "edit",
        priority: "high",
      });
      expect(response.status).toBe(200);
    });

    it("allows a member to update an assigned task without changing its assignee", async () => {
      const { user, project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id, user.id);

      const response = await putTask(task.id, project.id, {
        title: "Updated by member",
        description: "edit",
        priority: "high",
        userId: user.id,
      });
      expect(response.status).toBe(200);

      const persisted = await findTask(task.id);
      expect(persisted?.title).toBe("Updated by member");
      expect(persisted?.userId).toBe(user.id);
    });

    it("blocks a member from assigning an unassigned task through full update", async () => {
      const { user, project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await putTask(task.id, project.id, {
        title: "Member attempt",
        description: "nope",
        priority: "low",
        userId: user.id,
      });
      expect(response.status).toBe(403);
      expect((await findTask(task.id))?.userId).toBeNull();
    });

    it("blocks a member from unassigning a task through full update", async () => {
      const { user, project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id, user.id);

      const response = await putTask(task.id, project.id, {
        title: "Member attempt",
        description: "nope",
        priority: "low",
        userId: "",
      });
      expect(response.status).toBe(403);
      expect((await findTask(task.id))?.userId).toBe(user.id);
    });

    it("allows an admin to assign a task through full update", async () => {
      const { user, project, columns } = await memberWithProject("admin");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await putTask(task.id, project.id, {
        title: "Assigned by admin",
        description: "",
        priority: "medium",
        userId: user.id,
      });
      expect(response.status).toBe(200);
      expect((await findTask(task.id))?.userId).toBe(user.id);
    });

    it("blocks a viewer from updating a task", async () => {
      const { project, columns } = await memberWithProject("viewer");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await putTask(task.id, project.id, {
        title: "Viewer attempt",
        description: "nope",
        priority: "low",
      });
      expect(response.status).toBe(403);
    });
  });

  describe("resource coverage: task:assign", () => {
    it("blocks a member from assigning a task (assign is admin-tier)", async () => {
      const { user, project, columns } = await memberWithProject("member");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await app.request(
        `/api/task/assignee/${task.id}`,
        json("PUT", { userId: user.id }),
      );
      expect(response.status).toBe(403);
    });

    it("allows an admin to assign a task", async () => {
      const { user, project, columns } = await memberWithProject("admin");
      const task = await seedTask(project.id, columns.todo.id);

      const response = await app.request(
        `/api/task/assignee/${task.id}`,
        json("PUT", { userId: user.id }),
      );
      expect(response.status).toBe(200);
    });
  });
});
