import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUnseededWorkspaceMember } from "../support/fixtures/task-d-unseeded-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from the previous `authorization-boundaries` suite: the task
// assignee cases. The integration, public-project and activity cases there
// belong to other features.
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function ownerWithProject() {
  const owner = await createUnseededWorkspaceMember(app.db, "owner");
  const { project, columns } = await createProjectFixture(app.db, {
    workspaceId: owner.workspace.id,
  });
  return { ...owner, project, columns };
}

function seedTask(
  projectId: string,
  columnId: string,
  userId: string | null = null,
) {
  return createTask(app.db, {
    projectId,
    title: "Seeded",
    description: "",
    priority: "low",
    status: "to-do",
    columnId,
    number: 1,
    position: 1,
    userId,
  });
}

function projectTasks(projectId: string) {
  return app.db.find(TaskEntity, { where: { projectId } });
}

async function assigneeOf(taskId: string) {
  const task = await app.db.findOne(TaskEntity, { where: { id: taskId } });
  return task?.userId;
}

describe("task assignees stay inside the workspace", () => {
  it("refuses to create a task assigned to a non-member", async () => {
    const { user, project } = await ownerWithProject();
    const outsider = await createUnseededWorkspaceMember(app.db, "owner");

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/${project.id}`,
      json("POST", {
        title: "Cross-workspace assignment",
        description: "",
        priority: "low",
        status: "to-do",
        userId: outsider.user.id,
      }),
    );

    expect(response.status).toBe(403);
  });

  it("refuses to reassign an existing task to a non-member", async () => {
    const { user, project, columns } = await ownerWithProject();
    const outsider = await createUnseededWorkspaceMember(app.db, "owner");
    const task = await seedTask(project.id, columns.todo.id);

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/assignee/${task.id}`,
      json("PUT", { userId: outsider.user.id }),
    );

    expect(response.status).toBe(403);
  });
});

describe("every assignee write path is workspace scoped", () => {
  it("refuses a non-member through the task update endpoint", async () => {
    const { user, project, columns } = await ownerWithProject();
    const outsider = await createUnseededWorkspaceMember(app.db, "owner");
    const task = await seedTask(project.id, columns.todo.id);

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/${task.id}`,
      json("PUT", {
        title: "Seeded",
        status: "to-do",
        projectId: project.id,
        description: "",
        priority: "low",
        position: 1,
        userId: outsider.user.id,
      }),
    );

    expect(response.status).toBe(403);
  });

  it("imports the valid tasks and fails only the one with a bad assignee", async () => {
    const { user, project } = await ownerWithProject();
    const outsider = await createUnseededWorkspaceMember(app.db, "owner");

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/import/${project.id}`,
      json("POST", {
        tasks: [
          { title: "Good", status: "to-do", priority: "low" },
          {
            title: "Bad",
            status: "to-do",
            priority: "low",
            userId: outsider.user.id,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const stored = await projectTasks(project.id);
    expect(stored.map((t) => t.title)).toEqual(["Good"]);
  });

  it("refuses a non-member through task import", async () => {
    const { user, project } = await ownerWithProject();
    const outsider = await createUnseededWorkspaceMember(app.db, "owner");

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/import/${project.id}`,
      json("POST", {
        tasks: [
          {
            title: "Imported",
            status: "to-do",
            priority: "low",
            userId: outsider.user.id,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(await projectTasks(project.id)).toHaveLength(0);
  });

  it("stores a padded assignee id in its normalised form", async () => {
    const { user, project } = await ownerWithProject();

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/import/${project.id}`,
      json("POST", {
        tasks: [
          {
            title: "Imported",
            status: "to-do",
            priority: "low",
            userId: `  ${user.id}  `,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const [stored] = await projectTasks(project.id);
    expect(stored?.userId).toBe(user.id);
  });

  it("treats a whitespace-only assignee as an unassignment", async () => {
    const { user, project, columns } = await ownerWithProject();
    const task = await seedTask(project.id, columns.todo.id, user.id);

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/assignee/${task.id}`,
      json("PUT", { userId: "   " }),
    );

    expect(response.status).toBe(200);
    expect(await assigneeOf(task.id)).toBeNull();
  });

  it("assigns a padded but valid member id", async () => {
    const { user, project, columns } = await ownerWithProject();
    const task = await seedTask(project.id, columns.todo.id);

    app.auth.signIn(user);
    const response = await app.request(
      `/api/task/assignee/${task.id}`,
      json("PUT", { userId: `  ${user.id}  ` }),
    );

    expect(response.status).toBe(200);
    expect(await assigneeOf(task.id)).toBe(user.id);
  });

  it("refuses a non-member through the bulk assignee operation", async () => {
    const { user, project, columns } = await ownerWithProject();
    const outsider = await createUnseededWorkspaceMember(app.db, "owner");
    const task = await seedTask(project.id, columns.todo.id);

    app.auth.signIn(user);
    const response = await app.request(
      "/api/task/bulk",
      json("PATCH", {
        taskIds: [task.id],
        operation: "updateAssignee",
        value: outsider.user.id,
      }),
    );

    expect(response.status).toBe(403);
  });
});
