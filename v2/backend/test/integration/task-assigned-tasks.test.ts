import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type AssignedTasksResponse = {
  tasks: Array<{
    id: string;
    title: string;
    projectSlug: string;
    statusName: string | null;
    labels: Array<{ name: string }>;
  }>;
  total: number;
};

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

describe("API integration: assigned tasks", () => {
  it("lists the caller's open tasks across projects, soonest due first", async () => {
    const member = await createWorkspaceMember(app.db);
    const other = await createWorkspaceMember(app.db);
    await addWorkspaceMember(app.db, member.workspace.id, other.user.id);

    const web = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "web",
    });
    const api = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "api",
    });
    const archived = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "old",
    });
    await app.db.update(
      ProjectEntity,
      { id: archived.project.id },
      { archivedAt: new Date() },
    );

    const base = { priority: "medium", position: 1 };
    const later = await insertRow(app.db, TaskEntity, {
      ...base,
      projectId: web.project.id,
      title: "Due later",
      status: "to-do",
      columnId: web.columns.todo.id,
      userId: member.user.id,
      number: 1,
      dueDate: new Date("2030-02-01T00:00:00.000Z"),
    });
    const soon = await insertRow(app.db, TaskEntity, {
      ...base,
      projectId: api.project.id,
      title: "Due soon",
      status: "in-progress",
      columnId: api.columns.inProgress.id,
      userId: member.user.id,
      number: 1,
      dueDate: new Date("2030-01-01T00:00:00.000Z"),
    });
    const undated = await insertRow(app.db, TaskEntity, {
      ...base,
      projectId: web.project.id,
      title: "No due date",
      status: "to-do",
      columnId: web.columns.todo.id,
      userId: member.user.id,
      number: 2,
    });
    for (const values of [
      {
        projectId: web.project.id,
        title: "Already done",
        status: "done",
        columnId: web.columns.done.id,
        userId: member.user.id,
        number: 3,
      },
      {
        projectId: web.project.id,
        title: "Archived task",
        status: "archived",
        userId: member.user.id,
        number: 4,
      },
      {
        projectId: web.project.id,
        title: "Someone else's",
        status: "to-do",
        columnId: web.columns.todo.id,
        userId: other.user.id,
        number: 5,
      },
      {
        projectId: archived.project.id,
        title: "In an archived project",
        status: "to-do",
        columnId: archived.columns.todo.id,
        userId: member.user.id,
        number: 1,
      },
    ])
      await insertRow(app.db, TaskEntity, { ...base, ...values });
    await insertRow(app.db, LabelEntity, {
      name: "Bug",
      color: "red",
      taskId: soon.id,
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);

    const response = await app.request(
      `/api/task/assigned?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as AssignedTasksResponse;

    expect(body.total).toBe(3);
    const countResponse = await app.request(
      `/api/task/assigned?workspaceId=${member.workspace.id}&countOnly=true`,
    );
    expect(countResponse.status).toBe(200);
    expect(await countResponse.json()).toEqual({ tasks: [], total: 3 });
    expect(body.tasks.map((task) => task.id)).toEqual([
      soon.id,
      later.id,
      undated.id,
    ]);
    expect(body.tasks[0]).toMatchObject({
      projectSlug: "api",
      statusName: "In Progress",
      labels: [expect.objectContaining({ name: "Bug" })],
    });
  });

  it("uses column references when duplicate slugs include final columns", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const finalColumn = await insertRow(app.db, ColumnEntity, {
      projectId: project.id,
      name: "Duplicate to-do",
      slug: columns.todo.slug,
      position: -1,
      isFinal: true,
    });
    const task = await insertRow(app.db, TaskEntity, {
      projectId: project.id,
      title: "Once only",
      status: columns.todo.slug,
      columnId: columns.todo.id,
      userId: member.user.id,
    });
    await insertRow(app.db, TaskEntity, {
      projectId: project.id,
      title: "In the final duplicate",
      status: columns.todo.slug,
      columnId: finalColumn.id,
      userId: member.user.id,
      number: 2,
    });
    await insertRow(app.db, TaskEntity, {
      projectId: project.id,
      title: "Legacy ambiguous status",
      status: columns.todo.slug,
      userId: member.user.id,
      number: 3,
    });
    app.auth.signIn(member.user);
    const countResponse = await app.request(
      `/api/task/assigned?workspaceId=${member.workspace.id}&countOnly=true`,
    );
    expect(await countResponse.json()).toEqual({ tasks: [], total: 1 });
    const response = await app.request(
      `/api/task/assigned?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as AssignedTasksResponse;
    expect(body.total).toBe(1);
    const details = await app.request(`/api/task/${task.id}`);
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({
      id: task.id,
      columnId: columns.todo.id,
      workspaceId: member.workspace.id,
    });
    expect(body.tasks).toEqual([
      expect.objectContaining({ id: task.id, statusName: columns.todo.name }),
    ]);
  });

  it("refuses a workspace the caller does not belong to", async () => {
    const member = await createWorkspaceMember(app.db);
    const outsider = await createWorkspaceMember(app.db);

    app.auth.signIn(outsider.user);

    for (const countOnly of ["false", "true"]) {
      const response = await app.request(
        `/api/task/assigned?workspaceId=${member.workspace.id}&countOnly=${countOnly}`,
      );
      expect(response.status).toBe(404);
    }
  });

  it.each<Record<string, string[]>>([
    { workspace: ["read"] },
    { workspace: ["read"], project: ["read"] },
    { workspace: ["read"], task: ["read"] },
  ])(
    "rejects members missing project or task read permission (%j)",
    async (permissions) => {
      const member = await createWorkspaceMember(app.db, { role: "limited" });
      await addWorkspaceRole(
        app.db,
        member.workspace.id,
        "limited",
        permissions,
      );
      app.auth.signIn(member.user);
      const response = await app.request(
        `/api/task/assigned?workspaceId=${member.workspace.id}`,
      );
      expect(response.status).toBe(403);
      const count = await app.request(
        `/api/task/assigned?workspaceId=${member.workspace.id}&countOnly=true`,
      );
      expect(count.status).toBe(403);
    },
  );
});
