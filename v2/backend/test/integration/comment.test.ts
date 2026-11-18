import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { CommentEntity } from "../../src/database/entities/comment.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: task comments", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  async function seededTask(role?: string, title = "Shared comments") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title,
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });
    app.auth.signIn(member.user);
    return { ...member, task };
  }

  it("shares comments between the activity UI and comment API", async () => {
    const { task } = await seededTask();

    const formattedComment =
      "First paragraph\n\n\n\n- List item\n\n\n\nAfter list";
    const uiResponse = await app.request(
      "/api/activity/comment",
      json("POST", { taskId: task.id, comment: formattedComment }),
    );
    expect(uiResponse.status).toBe(200);

    const commentApiResponse = await app.request(`/api/comment/${task.id}`);
    expect(commentApiResponse.status).toBe(200);
    await expect(commentApiResponse.json()).resolves.toEqual([
      expect.objectContaining({
        content: formattedComment,
        taskId: task.id,
      }),
    ]);

    const mcpResponse = await app.request(
      `/api/comment/${task.id}`,
      json("POST", { content: "Created through MCP" }),
    );
    expect(mcpResponse.status).toBe(200);

    const activityResponse = await app.request(`/api/activity/${task.id}`);
    expect(activityResponse.status).toBe(200);
    const activities = (await activityResponse.json()) as Array<{
      content: string;
      type: string;
    }>;
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: formattedComment,
          type: "comment",
        }),
        expect.objectContaining({
          content: "Created through MCP",
          type: "comment",
        }),
      ]),
    );

    const storedComments = await app.db.find(ActivityEntity, {
      where: { taskId: task.id, type: "comment" },
    });
    expect(storedComments).toHaveLength(2);

    const legacyComments = await app.db.find(CommentEntity, {
      where: { taskId: task.id },
    });
    expect(legacyComments).toHaveLength(0);
  });

  it.each([
    { length: 10_000, status: 200 },
    { length: 10_001, status: 400 },
  ])(
    "returns $status when creating a $length-character comment",
    async ({ length, status }) => {
      const { task } = await seededTask(undefined, "Comment length limit");

      const comment = "x".repeat(length);
      const response = await app.request(
        "/api/activity/comment",
        json("POST", { taskId: task.id, comment }),
      );

      expect(response.status).toBe(status);
    },
  );

  it.each([
    { length: 10_000, status: 200 },
    { length: 10_001, status: 400 },
  ])(
    "returns $status when updating a $length-character comment",
    async ({ length, status }) => {
      const { task } = await seededTask(undefined, "Comment length limit");
      const createResponse = await app.request(
        "/api/activity/comment",
        json("POST", { taskId: task.id, comment: "Short comment" }),
      );
      expect(createResponse.status).toBe(200);
      const createdComment = (await createResponse.json()) as { id: string };
      const comment = "x".repeat(length);

      const response = await app.request(
        "/api/activity/comment",
        json("PUT", { activityId: createdComment.id, comment }),
      );

      expect(response.status).toBe(status);
    },
  );

  it("rejects comments through the generic activity endpoint", async () => {
    const { task, user } = await seededTask(
      undefined,
      "Generic comment activity",
    );

    const response = await app.request(
      "/api/activity/create",
      json("POST", {
        taskId: task.id,
        userId: user.id,
        message: "Comment through generic endpoint",
        type: "comment",
      }),
    );

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toEqual({
      message: "Use the comment endpoint to create comments",
      code: "BAD_REQUEST",
    });
  });

  it("records an external author for an authorized workspace administrator", async () => {
    const { task } = await seededTask("admin", "Imported");

    const attributed = await app.request(
      `/api/comment/${task.id}`,
      json("POST", {
        content: "From PLANKA",
        externalUserName: "Sam",
        externalSource: "planka",
      }),
    );
    expect(attributed.status).toBe(200);

    const [row] = await app.db.find(ActivityEntity, {
      where: { taskId: task.id },
    });
    expect(row?.externalUserName).toBe("Sam");
    expect(row?.externalSource).toBe("planka");
  });

  it("ignores an external name with no source, so it cannot look like a real user", async () => {
    const { task } = await seededTask(undefined, "Unattributed");

    await app.request(
      `/api/comment/${task.id}`,
      json("POST", { content: "Nice try", externalUserName: "Andrej" }),
    );

    const [row] = await app.db.find(ActivityEntity, {
      where: { taskId: task.id },
    });
    expect(row?.externalUserName).toBeNull();
  });

  it("rejects an unknown external source", async () => {
    const { task } = await seededTask(undefined, "Bad source");

    const response = await app.request(
      `/api/comment/${task.id}`,
      json("POST", {
        content: "Spoof",
        externalUserName: "Andrej",
        externalSource: "definitely-real",
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
