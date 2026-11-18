import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { BulkUpdateService } from "../../src/task/mutations/bulk/bulk-update.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { beforeNextTransaction } from "../support/fixtures/task-a-transactions";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  publish = vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

function bulkUpdateTasks(
  input: Parameters<BulkUpdateService["bulkUpdateTasks"]>[0],
) {
  return app.get(BulkUpdateService).bulkUpdateTasks(input);
}

async function statuses() {
  return (await app.db.find(TaskEntity)).map((task) => task.status);
}

it("validates every destination before committing any project", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const a = await createProjectFixture(app.db, { workspaceId: workspace.id });
  const b = await createProjectFixture(app.db, { workspaceId: workspace.id });
  await app.db.delete(ColumnEntity, { id: b.columns.inProgress.id });
  const tasks = [
    await createTask(app.db, {
      projectId: a.project.id,
      title: "a",
      status: "to-do",
    }),
    await createTask(app.db, {
      projectId: b.project.id,
      title: "b",
      status: "to-do",
    }),
  ];
  await expect(
    bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateStatus",
      value: "in-progress",
      userId: user.id,
    }),
  ).rejects.toThrow("Invalid status");
  expect(await statuses()).toEqual(["to-do", "to-do"]);
  expect(publish).not.toHaveBeenCalled();
});

it("commits every project before publishing successful status changes", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const a = await createProjectFixture(app.db, { workspaceId: workspace.id });
  const b = await createProjectFixture(app.db, { workspaceId: workspace.id });
  const tasks = [
    await createTask(app.db, {
      projectId: a.project.id,
      title: "a",
      status: "to-do",
    }),
    await createTask(app.db, {
      projectId: b.project.id,
      title: "b",
      status: "to-do",
    }),
  ];
  publish.mockImplementation(async () => {
    expect(await statuses()).toEqual(["in-progress", "in-progress"]);
  });
  expect(
    await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateStatus",
      value: "in-progress",
      userId: user.id,
    }),
  ).toMatchObject({ updatedCount: 2 });
  for (const task of tasks)
    expect(publish).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        taskId: task.id,
        oldStatus: "to-do",
        newStatus: "in-progress",
      }),
    );
});

it("uses the locked prior status when a concurrent edit rewrites a no-op snapshot", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "concurrent",
    status: "to-do",
  });
  beforeNextTransaction(app.dataSource, () =>
    app.db.update(TaskEntity, { id: task.id }, { status: "in-progress" }),
  );
  await bulkUpdateTasks({
    taskIds: [task.id],
    operation: "updateStatus",
    value: "to-do",
    userId: user.id,
  });
  expect(publish).toHaveBeenCalledWith(
    "task.status_changed",
    expect.objectContaining({
      taskId: task.id,
      oldStatus: "in-progress",
      newStatus: "to-do",
    }),
  );
});
