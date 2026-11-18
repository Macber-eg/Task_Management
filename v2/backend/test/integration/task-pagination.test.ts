import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import type { GetTasksOptions } from "../../src/task/queries/board/board-options";
import { BoardQueryService } from "../../src/task/queries/board/board-query.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { insertRows } from "../support/fixtures/task-b-insert-rows";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous tests read public boards through `GET /api/public-project/{id}`,
// which belongs to the project feature. The pagination and revision they
// verified come from the board query, so they call it with `publicOnly`.

type BoardTask = { id: string; number: number };
type Board = {
  columns: { tasks: BoardTask[] }[];
  archivedTasks: BoardTask[];
  plannedTasks: BoardTask[];
};

let app: TestApp;
let board: BoardQueryService;

beforeAll(async () => {
  app = await createTestApp();
  board = app.get(BoardQueryService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
});

async function fixture(count = 237, publicProject = false) {
  const member = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  if (publicProject)
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: true });
  const ids = await insertRows(
    app.db,
    TaskEntity,
    Array.from({ length: count }, (_, index) => ({
      id: `page-task-${String(index).padStart(4, "0")}`,
      projectId: project.id,
      title: `Task ${index}`,
      description: `Description ${index}`,
      number: index + 1,
      position: 100,
      status:
        index % 3 === 0 ? "planned" : index % 3 === 1 ? "archived" : "to-do",
      priority: index % 2 ? "high" : "low",
    })),
  );
  const tasks = ids.map((id) => ({ id }));
  app.auth.signIn(member.user);
  return { project, member, tasks };
}

function allTasks<T>(data: {
  columns: { tasks: T[] }[];
  archivedTasks: T[];
  plannedTasks: T[];
}) {
  return [
    ...data.columns.flatMap((column) => column.tasks),
    ...data.archivedTasks,
    ...data.plannedTasks,
  ];
}

function publicPage(projectId: string, options: GetTasksOptions = {}) {
  return board.getTasks(projectId, { ...options, publicOnly: true });
}

describe("bounded task pages", () => {
  it("bounds the default and retrieves every bucket with deterministic tied-position ordering", async () => {
    const { project, tasks } = await fixture();
    const first = await app.request(`/api/task/tasks/${project.id}`);
    expect(first.status).toBe(200);
    const initial = (await first.json()) as {
      data: Board;
      pagination: { totalPages: number };
    };
    expect(allTasks(initial.data)).toHaveLength(50);
    expect(initial.pagination).toMatchObject({
      page: 1,
      pageSize: 50,
      total: 237,
      totalPages: 5,
    });
    const ids = allTasks(initial.data).map((task) => task.id);
    for (let page = 2; page <= initial.pagination.totalPages; page++) {
      const response = await app.request(
        `/api/task/tasks/${project.id}?page=${page}`,
      );
      expect(response.status).toBe(200);
      const data = (await response.json()) as { data: Board };
      expect(allTasks(data.data).length).toBeLessThanOrEqual(50);
      ids.push(...allTasks(data.data).map((task) => task.id));
    }
    expect(new Set(ids).size).toBe(237);
    expect(ids.sort()).toEqual(tasks.map((task) => task.id).sort());
  });

  it("applies filters and sorting before paginating and keeps labels and links with their tasks", async () => {
    const { project, member, tasks } = await fixture();
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "github",
      config: "{}",
    });
    const task = tasks[235];
    if (!task) throw new Error("missing fixture task");
    await insertRow(app.db, LabelEntity, {
      name: "late-page-label",
      color: "red",
      workspaceId: member.workspace.id,
      taskId: task.id,
    });
    await insertRow(app.db, ExternalLinkEntity, {
      integrationId: integration.id,
      taskId: task.id,
      resourceType: "issue",
      externalId: "235",
      url: "https://github.com/example/repo/issues/235",
      metadata: JSON.stringify({ state: "open" }),
    });
    const response = await app.request(
      `/api/task/tasks/${project.id}?priority=high&sortBy=number&sortOrder=desc&limit=1`,
    );
    const payload = (await response.json()) as {
      data: Board;
      pagination: unknown;
    };
    expect(payload.pagination).toMatchObject({
      total: 118,
      pageSize: 1,
      totalPages: 118,
    });
    const match = allTasks(payload.data)[0];
    expect(match).toMatchObject({
      id: task.id,
      number: 236,
      labels: [{ name: "late-page-label" }],
      externalLinks: [{ externalId: "235", metadata: { state: "open" } }],
    });
  });

  it("caps explicit pages at 100 and rejects invalid limits or offsets", async () => {
    const { project } = await fixture();
    const response = await app.request(
      `/api/task/tasks/${project.id}?limit=100`,
    );
    expect(
      allTasks(((await response.json()) as { data: Board }).data),
    ).toHaveLength(100);
    for (const query of [
      "limit=101",
      "limit=0",
      "page=0",
      "page=-1",
      "page=1e9",
      "page=1000001",
    ])
      expect(
        (await app.request(`/api/task/tasks/${project.id}?${query}`)).status,
      ).toBe(400);
  });

  it("rejects another workspace before returning any page", async () => {
    const { project } = await fixture();
    const other = await createWorkspaceMember(app.db);
    app.auth.signIn(other.user);
    const response = await app.request(`/api/task/tasks/${project.id}?page=2`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Description");
  });

  it("paginates public boards", async () => {
    const { project } = await fixture(237, true);
    const first = await publicPage(project.id);
    expect(allTasks(first.data)).toHaveLength(50);
    expect(first.pagination.totalPages).toBe(5);
    const last = await publicPage(project.id, { page: 3, limit: 100 });
    expect(allTasks(last.data)).toHaveLength(37);
  });

  it.skip("rechecks public visibility on every request (GET /api/public-project/{id} belongs to the project feature, stream 2)", () => {});

  it.skip("validates public pagination before loading a board (GET /api/public-project/{id} belongs to the project feature, stream 2)", () => {});

  it("returns empty pages and an empty project without inventing tasks", async () => {
    const { project } = await fixture(0);
    for (const page of [1, 10]) {
      const response = await app.request(
        `/api/task/tasks/${project.id}?page=${page}`,
      );
      const payload = (await response.json()) as {
        data: Board;
        pagination: unknown;
      };
      expect(allTasks(payload.data)).toHaveLength(0);
      expect(payload.data.columns).toHaveLength(4);
      expect(payload.pagination).toMatchObject({
        total: 0,
        totalPages: 1,
        page,
      });
    }
  });
});

it.each(["create", "delete", "move", "reorder"])(
  "changes the public pagination revision after a concurrent %s",
  async (change) => {
    const { project, tasks } = await fixture(237, true);
    const first = await publicPage(project.id, { limit: 100 });
    const before = first.pagination.revision;
    expect(typeof before).toBe("string");
    const stable = await publicPage(project.id, { page: 2, limit: 100 });
    expect(stable.pagination.revision).toBe(before);
    const target = tasks[0]?.id ?? "";
    if (change === "create")
      await insertRow(app.db, TaskEntity, {
        id: "new-public-task",
        projectId: project.id,
        title: "new",
        number: 999,
        position: 1,
      });
    else if (change === "delete")
      await app.db.delete(TaskEntity, { id: target });
    else if (change === "move") {
      const { project: other } = await createProjectFixture(app.db, {
        workspaceId: project.workspaceId,
      });
      await app.db.update(TaskEntity, { id: target }, { projectId: other.id });
    } else await app.db.update(TaskEntity, { id: target }, { position: 200 });
    const later = await publicPage(project.id, { page: 2, limit: 100 });
    expect(later.pagination.revision).not.toBe(before);
  },
);

it("detects task edits between public pages regardless of sort order", async () => {
  const { project, tasks } = await fixture(237, true);
  const position = (await publicPage(project.id, { limit: 100 })).pagination
    .revision;
  const title = (await publicPage(project.id, { limit: 100, sortBy: "title" }))
    .pagination.revision;
  await app.db.update(
    TaskEntity,
    { id: tasks[0]?.id ?? "" },
    { title: "ZZZ new title" },
  );
  expect(
    (await publicPage(project.id, { limit: 100, page: 2 })).pagination.revision,
  ).not.toBe(position);
  expect(
    (await publicPage(project.id, { limit: 100, page: 2, sortBy: "title" }))
      .pagination.revision,
  ).not.toBe(title);
});

it.each(["label", "link", "assignee", "project", "subtask"])(
  "detects a %s edit to an earlier public page while loading a later page",
  async (change) => {
    const { project, tasks, member } = await fixture(2, true);
    const taskId = tasks[0]?.id ?? "";
    await app.db.update(TaskEntity, { id: taskId }, { userId: member.user.id });
    const label = await insertRow(app.db, LabelEntity, {
      taskId,
      workspaceId: member.workspace.id,
      name: "Before",
      color: "red",
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      taskId,
      resourceType: "pull_request",
      externalId: "1",
      url: "https://example.com/pr/1",
      metadata: JSON.stringify({ merged: false }),
    });
    const { project: childProject } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    await app.db.update(
      ProjectEntity,
      { id: childProject.id },
      { isPublic: true },
    );
    const child = await insertRow(app.db, TaskEntity, {
      projectId: childProject.id,
      title: "Child",
      status: "to-do",
    });
    await insertRow(app.db, TaskRelationEntity, {
      sourceTaskId: taskId,
      targetTaskId: child.id,
      relationType: "subtask",
    });
    const before = (await publicPage(project.id, { limit: 1 })).pagination
      .revision;
    expect(
      (await publicPage(project.id, { limit: 1, page: 2 })).pagination.revision,
    ).toBe(before);
    if (change === "label")
      await app.db.update(LabelEntity, { id: label.id }, { name: "After" });
    if (change === "link")
      await app.db.update(
        ExternalLinkEntity,
        { id: link.id },
        { metadata: JSON.stringify({ merged: true }) },
      );
    if (change === "assignee")
      await app.db.update(
        UserEntity,
        { id: member.user.id },
        { name: "Renamed", image: "https://example.com/avatar.png" },
      );
    if (change === "project")
      await app.db.update(
        ProjectEntity,
        { id: project.id },
        { name: "Renamed project" },
      );
    if (change === "subtask")
      await app.db.update(TaskEntity, { id: child.id }, { status: "done" });
    expect(
      (await publicPage(project.id, { limit: 1, page: 2 })).pagination.revision,
    ).not.toBe(before);
  },
);
