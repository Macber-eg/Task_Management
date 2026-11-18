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

afterEach(() => {
  vi.restoreAllMocks();
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
    description: "Old body",
    priority: "medium",
    status: "to-do",
    number: 1,
    position: 1,
  });
  const update = (values: Record<string, unknown>) =>
    app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: task.title,
        status: task.status,
        priority: task.priority,
        projectId: project.id,
        position: task.position,
        ...values,
      }),
    });
  return { task, update, project, user: member.user };
}

describe("general task update integration events", () => {
  it("publishes changed fields with full descriptions and preserves the realtime refresh", async () => {
    const { task, update, project, user } = await setup();
    const description = "New body ".repeat(2000);
    const response = await update({
      title: "Updated",
      description,
      priority: "high",
      status: "done",
    });
    expect(response.status).toBe(200);
    const common = { taskId: task.id, projectId: project.id, userId: user.id };
    expect(publish).toHaveBeenCalledWith(
      "task.title_changed",
      expect.objectContaining({
        ...common,
        oldTitle: "Original",
        newTitle: "Updated",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      "task.description_changed",
      expect.objectContaining({
        ...common,
        oldDescription: "Old body",
        newDescription: description,
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      "task.priority_changed",
      expect.objectContaining({
        ...common,
        oldPriority: "medium",
        newPriority: "high",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        ...common,
        oldStatus: "to-do",
        newStatus: "done",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining(common),
    );
    expect(
      await app.db.findOne(TaskEntity, { where: { id: task.id } }),
    ).toMatchObject({ title: "Updated", description, priority: "high" });
  });

  it.each([{}, { description: "Old body" }])(
    "does not emit field changes for omitted or unchanged fields: %j",
    async (values) => {
      const { update } = await setup();
      expect((await update(values)).status).toBe(200);
      expect(publish.mock.calls.map(([name]) => name)).toEqual([
        "task.updated",
      ]);
    },
  );

  it("emits an explicit description clear", async () => {
    const { update } = await setup();
    expect((await update({ description: "" })).status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      "task.description_changed",
      expect.objectContaining({
        oldDescription: "Old body",
        newDescription: "",
      }),
    );
  });

  it("does not publish changes for rejected updates", async () => {
    const { update } = await setup();
    expect((await update({ title: "Invalid", position: -1 })).status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});
