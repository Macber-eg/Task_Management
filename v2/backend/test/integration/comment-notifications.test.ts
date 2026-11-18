import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NotificationCreationService } from "../../src/notification/notification-creation.service";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// What a comment hands to the notification feature; delivery itself is
// covered by the notification suites.
describe("API integration: comment notifications", () => {
  const notifier = {
    createNotification:
      vi.fn<NotificationCreationService["createNotification"]>(),
  };
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [[NotificationCreationService, notifier]],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    notifier.createNotification.mockReset().mockResolvedValue(null);
  });

  async function seeded() {
    const author = await createWorkspaceMember(app.db, { userName: "Author" });
    const assignee = await createUser(app.db);
    const mentioned = await createUser(app.db);
    for (const user of [assignee, mentioned])
      await addWorkspaceMember(app.db, author.workspace.id, user.id);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: author.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Discussed",
      userId: assignee.id,
    });
    app.auth.signIn(author.user);
    return { ...author, project, task, assignee, mentioned };
  }

  function comment(taskId: string, content: string) {
    return app.request(`/api/comment/${taskId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  it("notifies each mentioned member, then the assignee, never the author", async () => {
    const { user, workspace, project, task, assignee, mentioned } =
      await seeded();
    const content = `Hi <kaneo-mention id="${mentioned.id}">@M</kaneo-mention> <kaneo-mention id="${user.id}">@Me</kaneo-mention> <kaneo-mention id="${mentioned.id}">@M</kaneo-mention>`;

    expect((await comment(task.id, content)).status).toBe(200);

    expect(notifier.createNotification.mock.calls).toEqual([
      [
        {
          userId: mentioned.id,
          type: "task_mention",
          eventData: {
            taskTitle: "Discussed",
            mentionerName: "Author",
            projectId: project.id,
            workspaceId: workspace.id,
          },
          resourceId: task.id,
          resourceType: "task",
        },
      ],
      [
        {
          userId: assignee.id,
          type: "task_comment",
          eventData: {
            taskTitle: "Discussed",
            commenterName: "Author",
            commentPreview: content.slice(0, 160),
            projectId: project.id,
            workspaceId: workspace.id,
          },
          resourceId: task.id,
          resourceType: "task",
        },
      ],
    ]);
  });

  it("does not notify a mentioned assignee twice", async () => {
    const { task, assignee } = await seeded();

    await comment(
      task.id,
      `<kaneo-mention id="${assignee.id}">@A</kaneo-mention> look`,
    );

    expect(notifier.createNotification.mock.calls).toEqual([
      [expect.objectContaining({ userId: assignee.id, type: "task_mention" })],
    ]);
  });
});
