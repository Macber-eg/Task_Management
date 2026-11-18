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
import type { DataSource } from "typeorm";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { TaskReorderService } from "../../src/task/mutations/task-reorder.service";
import { TaskUpdateService } from "../../src/task/mutations/task-update.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertTasks } from "../support/fixtures/task-c-insert-tasks";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;
let reorder: TaskReorderService;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp();
  reorder = app.get(TaskReorderService);
  publish = vi.spyOn(app.get(EventBus), "publish");
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  publish.mockReset().mockResolvedValue(undefined);
});

function findTask(id: string) {
  return app.db.findOne(TaskEntity, { where: { id } });
}

describe("atomic card reordering", () => {
  it("preserves fields edited since the board snapshot", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Another person's new title",
      description: "latest text",
      priority: "urgent",
      status: "to-do",
      position: 3,
    });
    const result = await reorder.reorderTasks(
      project.id,
      [{ id: task.id, position: 1, status: "in-progress" }],
      user.id,
    );
    expect(result).toEqual([
      { id: task.id, position: 1, status: "in-progress" },
    ]);
    expect(await findTask(task.id)).toMatchObject({
      title: task.title,
      description: task.description,
      priority: task.priority,
      position: 1,
      status: "in-progress",
    });
    expect(
      publish.mock.calls.filter(([event]) => event === "tasks.reordered"),
    ).toHaveLength(1);
  });

  it("rejects a card in another project without changing any positions", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const a = await createProjectFixture(app.db, { workspaceId: workspace.id });
    const b = await createProjectFixture(app.db, { workspaceId: workspace.id });
    const tasks = [
      await createTask(app.db, {
        projectId: a.project.id,
        title: "a",
        status: "to-do",
        position: 3,
      }),
      await createTask(app.db, {
        projectId: b.project.id,
        title: "b",
        status: "to-do",
        position: 4,
      }),
    ];
    await expect(
      reorder.reorderTasks(
        a.project.id,
        tasks.map((task) => ({ id: task.id, position: 0 })),
        user.id,
      ),
    ).rejects.toThrow("Tasks must belong");
    expect((await findTask(tasks[0]!.id))?.position).toBe(3);
    expect(publish).not.toHaveBeenCalled();
  });
});

it("atomically reorders more than 1,000 supported cards", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const tasks = await insertTasks(
    app.db,
    Array.from({ length: 1001 }, (_, i) => ({
      projectId: project.id,
      title: `card-${i}`,
      number: i + 1,
      position: i,
      status: "to-do",
    })),
  );
  const result = await reorder.reorderTasks(
    project.id,
    tasks.map((task, i) => ({ id: task.id, position: 1000 - i })),
    user.id,
  );
  expect(result).toHaveLength(1001);
  expect((await findTask(tasks[0]!.id))?.position).toBe(1000);
});

it("rejects a second drag from a stale column snapshot without duplicating positions", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const tasks: TaskEntity[] = [];
  for (let position = 0; position < 4; position++) {
    tasks.push(
      await createTask(app.db, {
        projectId: project.id,
        title: `card-${position}`,
        number: position + 1,
        position,
        status: "to-do",
      }),
    );
  }
  const expected = tasks.map((task) => ({
    id: task.id,
    position: task.position,
    status: task.status,
  }));
  await reorder.reorderTasks(
    project.id,
    tasks.map((task, index) => ({
      id: task.id,
      position: index === 0 ? 3 : index - 1,
    })),
    user.id,
    expected,
  );
  publish.mockClear();
  await expect(
    reorder.reorderTasks(
      project.id,
      [{ id: tasks[1]!.id, position: 3 }],
      user.id,
      expected,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const current = await app.db.find(TaskEntity, {
    where: { projectId: project.id },
  });
  expect(new Set(current.map((task) => task.position)).size).toBe(4);
  expect(publish).not.toHaveBeenCalled();
});

it("rejects a legacy full update superseded by an atomic reorder", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "card",
    status: "to-do",
    position: 0,
    priority: "low",
  });
  const dataSource: DataSource = app.dataSource;
  const transaction = dataSource.transaction.bind(dataSource) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const intercepted = vi
    .spyOn(dataSource, "transaction")
    .mockImplementationOnce((async (...args: unknown[]) => {
      await reorder.reorderTasks(
        project.id,
        [{ id: task.id, position: 2 }],
        user.id,
      );
      return transaction(...args);
    }) as DataSource["transaction"]);
  try {
    await expect(
      app.get(TaskUpdateService).updateTask({
        id: task.id,
        title: task.title,
        status: task.status,
        startDate: undefined,
        dueDate: undefined,
        projectId: project.id,
        description: undefined,
        priority: task.priority,
        position: 1,
        userId: undefined,
        currentUserId: user.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await findTask(task.id))?.position).toBe(2);
  } finally {
    intercepted.mockRestore();
  }
});
