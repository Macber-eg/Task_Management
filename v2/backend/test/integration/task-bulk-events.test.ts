import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { BulkUpdateService } from "../../src/task/mutations/bulk/bulk-update.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
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

describe("bulk task event snapshots", () => {
  it("preserves each task's old status, title and assignee for reopening and notifications", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const tasks = [
      await createTask(app.db, {
        projectId: project.id,
        title: "Completed",
        status: "done",
        userId: user.id,
        number: 1,
      }),
      await createTask(app.db, {
        projectId: project.id,
        title: "Queued",
        status: "to-do",
        number: 2,
      }),
    ];
    await app.get(BulkUpdateService).bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateStatus",
      value: "in-progress",
      userId: user.id,
    });
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.status_changed",
        expect.objectContaining({
          taskId: task.id,
          projectId: project.id,
          oldStatus: task.status,
          newStatus: "in-progress",
          title: task.title,
          assigneeId: task.userId,
        }),
      );
    }
    expect(await app.db.find(TaskEntity)).toEqual(
      expect.arrayContaining(
        tasks.map((task) =>
          expect.objectContaining({ id: task.id, status: "in-progress" }),
        ),
      ),
    );
  });

  it("preserves differing old priorities and titles in a single bulk operation", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const tasks = [
      await createTask(app.db, {
        projectId: project.id,
        title: "Low",
        priority: "low",
        number: 1,
      }),
      await createTask(app.db, {
        projectId: project.id,
        title: "High",
        priority: "high",
        number: 2,
      }),
    ];
    await app.get(BulkUpdateService).bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updatePriority",
      value: "medium",
      userId: user.id,
    });
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.priority_changed",
        expect.objectContaining({
          taskId: task.id,
          oldPriority: task.priority,
          newPriority: "medium",
          title: task.title,
        }),
      );
    }
  });
});
