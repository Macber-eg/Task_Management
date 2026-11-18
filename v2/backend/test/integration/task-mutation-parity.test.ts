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
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { TaskReminderSentEntity } from "../../src/database/entities/task-reminder-sent.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { BulkUpdateService } from "../../src/task/mutations/bulk/bulk-update.service";
import { TaskAssigneeService } from "../../src/task/mutations/fields/task-assignee.service";
import { TaskSimpleFieldService } from "../../src/task/mutations/fields/task-simple-field.service";
import { TaskStatusService } from "../../src/task/mutations/fields/task-status.service";
import { TaskUpdateService } from "../../src/task/mutations/task-update.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  beforeNextTransaction,
  trackTransactions,
} from "../support/fixtures/task-a-transactions";
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

function findTask(id: string) {
  return app.db.findOne(TaskEntity, { where: { id } });
}

function addReminder(taskId: string) {
  return insertRow(app.db, TaskReminderSentEntity, {
    taskId,
    reminderType: "due_today",
  });
}

it("full updates store title history, assignment events and reset reminders together", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "old",
    status: "to-do",
    priority: "low",
    dueDate: new Date("2030-01-01"),
    position: 0,
  });
  await addReminder(task.id);
  await app.get(TaskUpdateService).updateTask({
    id: task.id,
    title: "new",
    status: "to-do",
    startDate: undefined,
    dueDate: new Date("2030-02-01"),
    projectId: project.id,
    description: undefined,
    priority: "low",
    position: 0,
    userId: user.id,
    currentUserId: user.id,
  });
  expect(await app.db.find(ActivityEntity)).toEqual([
    expect.objectContaining({
      type: "title_changed",
      eventData: { oldTitle: "old", newTitle: "new" },
    }),
  ]);
  expect(await app.db.find(TaskReminderSentEntity)).toHaveLength(0);
  expect(publish).toHaveBeenCalledWith(
    "task.assignee_changed",
    expect.objectContaining({ newAssigneeId: user.id }),
  );
});

it("bulk due date updates clear claims and preserve claims for unchanged dates", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "task",
    status: "to-do",
    dueDate: new Date("2030-01-01"),
  });
  await addReminder(task.id);
  await bulkUpdateTasks({
    taskIds: [task.id],
    operation: "updateDueDate",
    value: "2030-01-01",
    userId: user.id,
  });
  expect(await app.db.find(TaskReminderSentEntity)).toHaveLength(1);
  await bulkUpdateTasks({
    taskIds: [task.id],
    operation: "updateDueDate",
    value: null,
    userId: user.id,
  });
  expect(await app.db.find(TaskReminderSentEntity)).toHaveLength(0);
  expect((await findTask(task.id))?.dueDate).toBeNull();
});

it("a single-field write does not attribute another concurrent field change to its actor", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "old",
    priority: "low",
  });
  beforeNextTransaction(app.dataSource, () =>
    app.db.update(TaskEntity, { id: task.id }, { title: "concurrent title" }),
  );
  await app.get(TaskSimpleFieldService).updateTaskPriority({
    id: task.id,
    priority: "high",
    currentUserId: user.id,
  });
  expect(publish.mock.calls.map(([type]) => type)).toEqual([
    "task.priority_changed",
  ]);
});

it("bulk due dates use locked current dates before clearing reminder claims", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "date race",
    dueDate: new Date("2030-01-01"),
  });
  beforeNextTransaction(app.dataSource, async () => {
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { dueDate: new Date("2030-02-01") },
    );
    await addReminder(task.id);
  });
  await bulkUpdateTasks({
    taskIds: [task.id],
    operation: "updateDueDate",
    value: "2030-01-01",
    userId: user.id,
  });
  expect(await app.db.find(TaskReminderSentEntity)).toHaveLength(0);
  expect(publish).toHaveBeenCalledWith(
    "task.due_date_changed",
    expect.objectContaining({
      oldDueDate: new Date("2030-02-01"),
      newDueDate: new Date("2030-01-01"),
    }),
  );
});

it("bulk assignment resolves the assignee once and bulk status refreshes each project once", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const tasks = await Promise.all(
    Array.from({ length: 3 }, (_, i) =>
      createTask(app.db, {
        projectId: project.id,
        title: `bulk-${i}`,
        number: i + 1,
        status: "to-do",
      }),
    ),
  );
  // The previous test counted `db.query.userTable.findFirst` calls; here the
  // assignee name lookup is counted. Every manager query goes through
  // `dataSource.query`, so that one spy sees them all.
  const isNameLookup = (sql: unknown) =>
    typeof sql === "string" && /SELECT name FROM "user"/.test(sql);
  const dataSourceQuery = vi.spyOn(app.dataSource, "query");
  await bulkUpdateTasks({
    taskIds: tasks.map((task) => task.id),
    operation: "updateAssignee",
    value: user.id,
    userId: user.id,
  });
  const nameLookups = dataSourceQuery.mock.calls.filter(([sql]) =>
    isNameLookup(sql),
  );
  expect(nameLookups).toHaveLength(1);
  publish.mockClear();
  await bulkUpdateTasks({
    taskIds: tasks.map((task) => task.id),
    operation: "updateStatus",
    value: "in-progress",
    userId: user.id,
  });
  expect(
    publish.mock.calls.filter(([type]) => type === "task-relation.refresh"),
  ).toHaveLength(1);
});

it.each(["single", "bulk"])(
  "%s priority writes publish the actual overwritten priority",
  async (mode) => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "priority race",
      priority: "low",
    });
    beforeNextTransaction(app.dataSource, () =>
      app.db.update(TaskEntity, { id: task.id }, { priority: "high" }),
    );
    if (mode === "single")
      await app.get(TaskSimpleFieldService).updateTaskPriority({
        id: task.id,
        priority: "low",
        currentUserId: user.id,
      });
    else
      await bulkUpdateTasks({
        taskIds: [task.id],
        operation: "updatePriority",
        value: "low",
        userId: user.id,
      });
    expect(publish).toHaveBeenCalledWith(
      "task.priority_changed",
      expect.objectContaining({ oldPriority: "high", newPriority: "low" }),
    );
  },
);

it("validates status and assignment without a second pool client inside the mutation transaction", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "pool safety",
  });
  const transactions = trackTransactions(app.dataSource);
  // Every manager query reaches `dataSource.query`; the transaction's own
  // manager passes its query runner. One without a runner while the
  // transaction is open would take a second pool connection while the first
  // holds the row lock.
  const query = app.dataSource.query.bind(app.dataSource);
  vi.spyOn(app.dataSource, "query").mockImplementation(((
    sql: string,
    parameters?: unknown[],
    queryRunner?: unknown,
  ) => {
    if (transactions.inside() && !queryRunner)
      throw new Error("Validation attempted a second pool connection");
    return query(sql, parameters, queryRunner as never);
  }) as never);
  await app.get(TaskStatusService).updateTaskStatus({
    id: task.id,
    status: "done",
    currentUserId: user.id,
  });
  await app.get(TaskAssigneeService).updateTaskAssignee({
    id: task.id,
    userId: user.id,
    currentUserId: user.id,
  });
  expect(await findTask(task.id)).toMatchObject({
    status: "done",
    userId: user.id,
  });
});

it.each(["single", "full"])(
  "%s status repairs notify clients without recording a status transition",
  async (mode) => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const column = await app.db.findOne(ColumnEntity, {
      where: { slug: "to-do" },
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Legacy task",
      status: "to-do",
      columnId: null,
    });
    if (mode === "single")
      await app.get(TaskStatusService).updateTaskStatus({
        id: task.id,
        status: task.status,
        currentUserId: user.id,
      });
    else
      await app.get(TaskUpdateService).updateTask({
        id: task.id,
        title: task.title,
        status: task.status,
        startDate: undefined,
        dueDate: undefined,
        projectId: project.id,
        description: undefined,
        priority: task.priority,
        position: task.position ?? 0,
        userId: undefined,
        currentUserId: user.id,
      });
    expect((await findTask(task.id))?.columnId).toBe(column?.id);
    expect(publish).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: task.id, projectId: project.id }),
    );
    expect(publish).toHaveBeenCalledWith(
      "task-relation.refresh",
      expect.objectContaining({ projectId: project.id }),
    );
    expect(
      publish.mock.calls.some(([type]) => type === "task.status_changed"),
    ).toBe(false);
  },
);

it("rejects a bulk due-date update after a task moves out of the authorized project", async () => {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const other = await createWorkspaceMember(app.db);
  const { project: foreign } = await createProjectFixture(app.db, {
    workspaceId: other.workspace.id,
  });
  const dueDate = new Date("2030-01-01");
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "Moved task",
    dueDate,
  });
  await addReminder(task.id);
  beforeNextTransaction(app.dataSource, () =>
    app.db.update(TaskEntity, { id: task.id }, { projectId: foreign.id }),
  );
  await expect(
    bulkUpdateTasks({
      taskIds: [task.id],
      operation: "updateDueDate",
      value: null,
      userId: user.id,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await findTask(task.id))?.dueDate).toEqual(dueDate);
  expect(await app.db.find(TaskReminderSentEntity)).toHaveLength(1);
  expect(publish).not.toHaveBeenCalled();
});
