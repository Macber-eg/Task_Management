import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { TaskCreationService } from "../../src/task/mutations/task-creation.service";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
import { MAX_TASK_POSITION } from "../../src/task/shared/task-position";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
  // The previous tests replaced the event publisher; nothing here asserts on it.
  vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
});

async function setup() {
  const member = await createWorkspaceMember(app.db);
  const { project, columns } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  app.auth.signIn(member.user);
  const task = await createTask(app.db, {
    projectId: project.id,
    columnId: columns.todo.id,
    title: "Original",
    status: "to-do",
    number: 1,
    position: 1,
  });
  await app.db.update(ProjectEntity, { id: project.id }, { lastTaskNumber: 1 });
  return { ...member, project, columns, task };
}

function createTaskDirectly(input: {
  projectId: string;
  currentUserId: string;
  title: string;
  status: string;
}) {
  return app.get(TaskCreationService).createTask(input);
}

describe("task position bounds and legacy recovery", () => {
  it.each([-1, 0.5, 2_147_483_647, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    "rejects unsafe position %s before updating any task field",
    async (position) => {
      const { project, task } = await setup();
      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Should not write",
          description: "",
          status: "to-do",
          priority: "low",
          projectId: project.id,
          position,
        }),
      });
      expect(response.status).toBe(400);
      expect(
        await app.db.findOne(TaskEntity, { where: { id: task.id } }),
      ).toMatchObject({ title: "Original", position: 1 });
    },
  );

  it("accepts bounded positions and recovers legacy overflow without touching other columns", async () => {
    const { project, columns, task, user } = await setup();
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { position: 2_147_483_647 },
    );
    const earlier = await createTask(app.db, {
      projectId: project.id,
      columnId: columns.todo.id,
      title: "Earlier",
      number: 2,
      status: "to-do",
      position: 10,
    });
    const other = await createTask(app.db, {
      projectId: project.id,
      columnId: columns.done.id,
      title: "Other column",
      number: 3,
      status: "done",
      position: 999,
    });
    await app.db.update(
      ProjectEntity,
      { id: project.id },
      { lastTaskNumber: 3 },
    );
    const appended = await createTaskDirectly({
      projectId: project.id,
      currentUserId: user.id,
      title: "Appended",
      status: "to-do",
    });
    expect(appended.position).toBe(3);
    const rows = await app.db.find(TaskEntity, { order: { position: "ASC" } });
    expect(rows.map((row) => [row.id, row.position])).toEqual([
      [earlier.id, 1],
      [task.id, 2],
      [appended.id, 3],
      [other.id, 999],
    ]);
  });

  it("repairs virtual-status tasks and serializes concurrent appends", async () => {
    const { project, task, user } = await setup();
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { status: "planned", columnId: null, position: MAX_TASK_POSITION },
    );
    const added = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createTaskDirectly({
          projectId: project.id,
          currentUserId: user.id,
          title: `New ${index}`,
          status: "planned",
        }),
      ),
    );
    expect(added.map((row) => row.position).sort()).toEqual([2, 3, 4, 5]);
    expect(new Set(added.map((row) => row.number)).size).toBe(4);
  });

  it("recovers an overflowed destination when moving a task", async () => {
    const { project, user, workspace, task } = await setup();
    const { project: destination, columns } = await createProjectFixture(
      app.db,
      { workspaceId: workspace.id },
    );
    const poisoned = await createTask(app.db, {
      projectId: destination.id,
      columnId: columns.todo.id,
      title: "Existing",
      status: "to-do",
      position: 2_147_483_647,
    });
    await app.db.update(
      ProjectEntity,
      { id: destination.id },
      { lastTaskNumber: 1 },
    );
    const result = await app.get(TaskMoveService).moveTask({
      taskId: task.id,
      destinationProjectId: destination.id,
      currentUserId: user.id,
    });
    expect(result.task).toMatchObject({
      projectId: destination.id,
      position: 2,
    });
    expect(
      await app.db.findOne(TaskEntity, { where: { id: poisoned.id } }),
    ).toHaveProperty("position", 1);
    expect(result.sourceProjectId).toBe(project.id);
  });
});
