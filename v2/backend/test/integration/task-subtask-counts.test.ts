import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { TaskStatusService } from "../../src/task/mutations/fields/task-status.service";
import { TaskDeletionService } from "../../src/task/mutations/task-deletion.service";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
import { BoardQueryService } from "../../src/task/queries/board/board-query.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous tests watched a WebSocket connection receive
// TASK_RELATION_UPDATED. Turning events into socket messages belongs to the
// realtime feature (stream 5); here the assertions are on the events the task
// code publishes, which that layer turns into parent board refreshes:
// `task.status_changed` (without skipSubtaskParentRefresh), `task.moved`,
// `task-relation.deleted` (with sourceTaskId) and `subtask-parents.refresh`.

type CountedTask = { id: string; subtaskCounts: unknown };
type Board = {
  columns: { tasks: CountedTask[] }[];
  plannedTasks: CountedTask[];
  archivedTasks: CountedTask[];
};

let app: TestApp;
let board: BoardQueryService;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp();
  board = app.get(BoardQueryService);
  publish = vi.spyOn(app.get(EventBus), "publish");
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  publish.mockClear();
});

function addTask(projectId: string, status = "to-do") {
  return insertRow(app.db, TaskEntity, {
    projectId,
    title: "Task",
    status,
    number: null,
  });
}

function relate(
  sourceTaskId: string,
  targetTaskId: string,
  relationType = "subtask",
) {
  return insertRow(app.db, TaskRelationEntity, {
    sourceTaskId,
    targetTaskId,
    relationType,
  });
}

function tasksOf(data: unknown) {
  const { columns, plannedTasks, archivedTasks } = data as Board;
  return [
    ...columns.flatMap((c) => c.tasks),
    ...plannedTasks,
    ...archivedTasks,
  ];
}

async function countsFor(projectId: string, taskId: string) {
  const { data } = await board.getTasks(projectId);
  return tasksOf(data).find((task) => task.id === taskId)?.subtaskCounts;
}

function published(type: string) {
  return publish.mock.calls
    .filter(([name]) => name === type)
    .map(([, data]) => data);
}

describe("API integration: subtask counters", () => {
  it("counts direct children across filters and pagination, excluding other relations and incoming parents", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const parent = await addTask(project.id);
    const child = await addTask(project.id, "done");
    const grandchild = await addTask(project.id, "done");
    const other = await addTask(project.id, "in-progress");
    await relate(parent.id, child.id);
    await relate(child.id, grandchild.id);
    await relate(parent.id, other.id, "blocks");
    await relate(other.id, parent.id);
    await app.db.update(
      TaskEntity,
      { id: parent.id },
      { description: "- [x] Checklist\n- [ ] Checklist" },
    );

    app.auth.signIn(member.user);
    const response = await app.request(
      `/api/task/tasks/${project.id}?status=to-do&limit=1&page=1`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Board };
    const tasks = body.data.columns.flatMap((column) => column.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: parent.id,
      subtaskCounts: { completed: 1, total: 1 },
    });
  });

  it("uses the child's final columns across projects and includes planned and archived children", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    await app.db.update(
      ColumnEntity,
      { id: other.columns.done.id },
      { isFinal: false },
    );
    await insertRow(app.db, ColumnEntity, {
      projectId: other.project.id,
      name: "Shipped",
      slug: "shipped",
      isFinal: true,
    });
    const parent = await addTask(project.id, "planned");
    for (const status of ["shipped", "done", "planned", "archived"]) {
      const child = await addTask(other.project.id, status);
      await relate(parent.id, child.id);
    }
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 1,
      total: 4,
    });
    await app.db.update(TaskEntity, { id: parent.id }, { status: "archived" });
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 1,
      total: 4,
    });
  });

  it.skip("marks the same final-column child completed in the task relation list (getTaskRelations belongs to the task-relation feature, stream 3)", () => {});

  it("returns zero for empty tasks and reflects completion, reopening, unlinking, and deletion", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const status = app.get(TaskStatusService);
    const empty = (await board.getTasks(project.id)).data as unknown as Board;
    expect(empty.columns.every((c) => c.tasks.length === 0)).toBe(true);
    const parent = await addTask(project.id);
    const child = await addTask(project.id);
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 0,
      total: 0,
    });
    const relation = await relate(parent.id, child.id);
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 0,
      total: 1,
    });
    await status.updateTaskStatus({
      id: child.id,
      status: "done",
      currentUserId: member.user.id,
    });
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 1,
      total: 1,
    });
    await status.updateTaskStatus({
      id: child.id,
      status: "to-do",
      currentUserId: member.user.id,
    });
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 0,
      total: 1,
    });
    await app.db.delete(TaskRelationEntity, { id: relation.id });
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 0,
      total: 0,
    });
    await relate(parent.id, child.id);
    await app.get(TaskDeletionService).deleteTask(child.id, member.user.id);
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 0,
      total: 0,
    });
  });

  it("excludes cross-workspace relations and private-project counts on public boards", async () => {
    const member = await createWorkspaceMember(app.db);
    const stranger = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const privateProject = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const foreignProject = await createProjectFixture(app.db, {
      workspaceId: stranger.workspace.id,
    });
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: true });
    const parent = await addTask(project.id);
    const publicChild = await addTask(project.id, "done");
    const privateChild = await addTask(privateProject.project.id, "done");
    const foreignChild = await addTask(foreignProject.project.id, "done");
    await relate(parent.id, publicChild.id);
    await relate(parent.id, privateChild.id);
    // Simulate a legacy malformed relation; it must not cross the workspace boundary.
    await relate(parent.id, foreignChild.id);
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 2,
      total: 2,
    });
    // `getPublicProject` (stream 2) reads the board with publicOnly.
    const publicBoard = await board.getTasks(project.id, { publicOnly: true });
    expect(
      tasksOf(publicBoard.data).find((t) => t.id === parent.id)?.subtaskCounts,
    ).toEqual({ completed: 1, total: 1 });
  });

  it("refreshes a parent board when a child in another project is completed or deleted", async () => {
    const member = await createWorkspaceMember(app.db);
    const parentProject = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const childProject = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const parent = await addTask(parentProject.project.id);
    const child = await addTask(childProject.project.id);
    await relate(parent.id, child.id);

    await app.get(TaskStatusService).updateTaskStatus({
      id: child.id,
      status: "done",
      currentUserId: member.user.id,
    });
    const [statusChanged] = published("task.status_changed");
    expect(statusChanged).toMatchObject({
      taskId: child.id,
      projectId: childProject.project.id,
      newStatus: "done",
    });
    expect(statusChanged).not.toHaveProperty("skipSubtaskParentRefresh");

    publish.mockClear();
    await app.get(TaskDeletionService).deleteTask(child.id, member.user.id);
    expect(published("task-relation.deleted")).toEqual([
      expect.objectContaining({
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        projectId: childProject.project.id,
      }),
    ]);
    expect(await countsFor(parentProject.project.id, parent.id)).toEqual({
      completed: 0,
      total: 0,
    });
  });

  it.skip("delivers TASK_RELATION_UPDATED to parent board sockets (WebSocket delivery belongs to the realtime feature, stream 5)", () => {});

  it.skip("refreshes parent boards when a child's column is marked final or reopened (column update belongs to the column feature, stream 2)", () => {});

  it.each(["delete", "updateStatus"])(
    "batches parent refreshes when the bulk API performs %s",
    async (operation) => {
      const member = await createWorkspaceMember(app.db, { role: "owner" });
      const parentProject = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const childProject = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const parent = await addTask(parentProject.project.id);
      const child = await addTask(childProject.project.id);
      const secondChild = await addTask(childProject.project.id);
      await relate(parent.id, child.id);
      await relate(parent.id, secondChild.id);

      app.auth.signIn(member.user);
      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [child.id, secondChild.id],
          operation,
          value: operation === "updateStatus" ? "done" : undefined,
        }),
      });
      expect(response.status).toBe(200);
      // One batched refresh replaces the per-task ones.
      expect(published("subtask-parents.refresh")).toEqual([
        { projects: [{ projectId: parentProject.project.id }] },
      ]);
      for (const event of published("task.status_changed"))
        expect(event).toMatchObject({ skipSubtaskParentRefresh: true });
      expect(await countsFor(parentProject.project.id, parent.id)).toEqual({
        completed: operation === "updateStatus" ? 2 : 0,
        total: operation === "updateStatus" ? 2 : 0,
      });
    },
  );

  it.skip("refreshes surviving parent boards when a child project is deleted (project deletion belongs to the project feature, stream 2)", () => {});
});

describe("subtask counter mutation paths", () => {
  it.each([false, true])(
    "refreshes a parent after moving a child into a nonfinal workflow (sameSource=%s)",
    async (sameSource) => {
      const member = await createWorkspaceMember(app.db);
      const parentProject = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const source = sameSource
        ? parentProject
        : await createProjectFixture(app.db, {
            workspaceId: member.workspace.id,
          });
      const destination = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      await app.db.update(
        ColumnEntity,
        { id: destination.columns.done.id },
        { isFinal: false },
      );
      const parent = await addTask(parentProject.project.id);
      const child = await addTask(source.project.id, "done");
      await relate(parent.id, child.id);
      expect(await countsFor(parentProject.project.id, parent.id)).toEqual({
        completed: 1,
        total: 1,
      });

      await app.get(TaskMoveService).moveTask({
        taskId: child.id,
        destinationProjectId: destination.project.id,
        currentUserId: member.user.id,
      });
      expect(published("task.moved")).toEqual([
        expect.objectContaining({
          taskId: child.id,
          fromProjectId: source.project.id,
          toProjectId: destination.project.id,
        }),
      ]);
      expect(await countsFor(parentProject.project.id, parent.id)).toEqual({
        completed: 0,
        total: 1,
      });
    },
  );

  it("refreshes same-project parents in other windows after child deletion", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const parent = await addTask(project.id);
    const child = await addTask(project.id, "done");
    await relate(parent.id, child.id);
    await app.get(TaskDeletionService).deleteTask(child.id, member.user.id);
    expect(published("task.deleted")).toEqual([
      expect.objectContaining({ taskId: child.id, projectId: project.id }),
    ]);
    expect(await countsFor(project.id, parent.id)).toEqual({
      completed: 0,
      total: 0,
    });
  });
});

it("returns bounded board refresh descriptions and current parent progress", async () => {
  const member = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  const parent = await addTask(project.id);
  const child = await addTask(project.id, "done");
  await relate(parent.id, child.id);
  await app.db.update(
    TaskEntity,
    { id: child.id },
    { description: "😀".repeat(20000) },
  );
  app.auth.signIn(member.user);
  const response = await app.request(`/api/task/${child.id}?view=board`);
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    description: null,
    descriptionDeferred: true,
    subtaskCounts: { completed: 0, total: 0 },
    parentSubtaskCounts: [{ taskId: parent.id, completed: 1, total: 1 }],
  });
  expect(body).not.toHaveProperty("workspaceId");
});
