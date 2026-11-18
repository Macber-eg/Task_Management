import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { TaskTitleService } from "../../src/task/mutations/fields/task-title.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: task title activity", () => {
  let app: TestApp;
  let titles: TaskTitleService;

  beforeAll(async () => {
    app = await createTestApp();
    titles = app.get(TaskTitleService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  async function createTaskFixture() {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Original title",
      description: "Activity test task",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });

    return { member, task };
  }

  it("persists the title and its activity before returning", async () => {
    const { member, task } = await createTaskFixture();
    app.auth.signIn(member.user);

    const response = await app.request(`/api/task/title/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated title" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: task.id,
      title: "Updated title",
    });

    const [persistedTask, activities] = await Promise.all([
      app.db.findOne(TaskEntity, { where: { id: task.id } }),
      app.db.find(ActivityEntity, {
        where: { taskId: task.id, type: "title_changed" },
      }),
    ]);

    expect(persistedTask?.title).toBe("Updated title");
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      type: "title_changed",
      eventData: {
        oldTitle: "Original title",
        newTitle: "Updated title",
      },
    });
  });

  it("does not create activity for an unchanged title", async () => {
    const { member, task } = await createTaskFixture();

    const result = await titles.updateTaskTitle({
      id: task.id,
      title: task.title,
      currentUserId: member.user.id,
    });

    expect(result.title).toBe(task.title);
    expect(
      await app.db.find(ActivityEntity, { where: { taskId: task.id } }),
    ).toHaveLength(0);
  });

  it("rolls back the title when the activity insert fails", async () => {
    const { task } = await createTaskFixture();

    await expect(
      titles.updateTaskTitle({
        id: task.id,
        title: "Must not persist",
        currentUserId: "missing-user",
      }),
    ).rejects.toThrow();

    const persistedTask = await app.db.findOne(TaskEntity, {
      where: { id: task.id },
    });

    expect(persistedTask?.title).toBe("Original title");
    expect(
      await app.db.find(ActivityEntity, { where: { taskId: task.id } }),
    ).toHaveLength(0);
  });
});
