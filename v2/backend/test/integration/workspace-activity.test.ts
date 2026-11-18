import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type WorkspaceActivityResponse = Array<{
  type: string;
  excerpt: string | null;
  content?: string;
  userName: string | null;
  taskTitle: string;
  projectSlug: string;
  eventData: Record<string, unknown> | null;
}>;

const DAY = 24 * 60 * 60 * 1000;

describe("API integration: workspace activity", () => {
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

  it("returns recent activity across the workspace, newest first", async () => {
    const member = await createWorkspaceMember(app.db, { userName: "Mira" });
    const elsewhere = await createWorkspaceMember(app.db);
    const web = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "web",
    });
    await app.db.update(
      ColumnEntity,
      { id: web.columns.todo.id },
      { name: "Queued for QA" },
    );
    const foreign = await createProjectFixture(app.db, {
      workspaceId: elsewhere.workspace.id,
      slug: "foreign",
    });

    const task = await createTask(app.db, {
      projectId: web.project.id,
      title: "Fix reconnect loop",
      status: "to-do",
      columnId: web.columns.todo.id,
      priority: "high",
      number: 1,
      position: 1,
    });
    const foreignTask = await createTask(app.db, {
      projectId: foreign.project.id,
      title: "Another workspace's task",
      status: "to-do",
      columnId: foreign.columns.todo.id,
      priority: "low",
      number: 1,
      position: 1,
    });

    const now = Date.now();
    for (const activity of [
      {
        taskId: task.id,
        type: "status_changed",
        userId: member.user.id,
        eventData: { oldStatus: "to-do", newStatus: "in-progress" },
        createdAt: new Date(now - 2 * DAY),
      },
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: 'Reproduced <kaneo-mention id="u">@Alex</kaneo-mention>',
        createdAt: new Date(now - DAY),
      },
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: "Too old to show",
        createdAt: new Date(now - 45 * DAY),
      },
      {
        taskId: foreignTask.id,
        type: "comment",
        userId: elsewhere.user.id,
        content: "Private to another workspace",
        createdAt: new Date(now),
      },
    ]) {
      await insertRow(app.db, ActivityEntity, activity);
    }

    app.auth.signIn(member.user);

    const response = await app.request(
      `/api/activity/workspace/${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as WorkspaceActivityResponse;

    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      type: "comment",
      excerpt: "Reproduced @Alex",
      userName: "Mira",
      taskTitle: "Fix reconnect loop",
      projectSlug: "web",
    });
    expect(body[0]).not.toHaveProperty("content");
    expect(body[1]).toMatchObject({
      type: "status_changed",
      excerpt: null,
      eventData: {
        oldStatus: "to-do",
        newStatus: "in-progress",
        oldStatusName: "Queued for QA",
        newStatusName: "In Progress",
      },
    });
  });

  it("refuses a workspace the caller does not belong to", async () => {
    const member = await createWorkspaceMember(app.db);
    const outsider = await createWorkspaceMember(app.db);

    app.auth.signIn(outsider.user);

    const response = await app.request(
      `/api/activity/workspace/${member.workspace.id}`,
    );
    expect(response.status).toBe(404);
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
        `/api/activity/workspace/${member.workspace.id}`,
      );
      expect(response.status).toBe(403);
    },
  );

  it("bounds an inbox preview while preserving full task history", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Busy task",
      status: "to-do",
    });
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      await insertRow(app.db, ActivityEntity, {
        taskId: task.id,
        type: "comment",
        content: `Comment ${i}`,
        createdAt: new Date(now - i * 1000),
      });
    }
    app.auth.signIn(member.user);
    const preview = await app.request(`/api/activity/${task.id}?limit=6`);
    expect(preview.status).toBe(200);
    expect(
      ((await preview.json()) as { content: string }[]).map(
        (event) => event.content,
      ),
    ).toEqual(Array.from({ length: 6 }, (_, i) => `Comment ${i}`));
    const full = await app.request(`/api/activity/${task.id}`);
    expect(full.status).toBe(200);
    expect(await full.json()).toHaveLength(15);
    for (const limit of ["0", "101", "abc"]) {
      const invalid = await app.request(
        `/api/activity/${task.id}?limit=${limit}`,
      );
      expect(invalid.status).toBe(400);
    }
  });

  it("does not guess a historical column name when its status slug is ambiguous", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    await insertRow(app.db, ColumnEntity, {
      projectId: project.id,
      slug: columns.todo.slug,
      name: "Other queue",
      position: -1,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Historical status",
      status: "in-progress",
      columnId: columns.inProgress.id,
    });
    await insertRow(app.db, ActivityEntity, {
      taskId: task.id,
      type: "status_changed",
      eventData: {
        oldStatus: columns.todo.slug,
        newStatus: columns.inProgress.slug,
      },
    });
    app.auth.signIn(member.user);
    const response = await app.request(
      `/api/activity/workspace/${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const [event] = (await response.json()) as WorkspaceActivityResponse;
    expect(event?.eventData).not.toHaveProperty("oldStatusName");
    expect(event?.eventData).toMatchObject({
      oldStatus: "to-do",
      newStatusName: "In Progress",
    });
  });
});
