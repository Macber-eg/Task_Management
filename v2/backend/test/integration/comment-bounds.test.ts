import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

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

it.each(["comment", "activity"])(
  "bounds both writes on the %s API without changing stored content",
  async (surface) => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Comment bounds",
      status: "to-do",
    });
    app.auth.signIn(member.user);
    const request = (method: string, content: string, id = task.id) =>
      app.request(
        surface === "comment" ? `/api/comment/${id}` : "/api/activity/comment",
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            surface === "comment"
              ? { content }
              : {
                  comment: content,
                  ...(method === "POST" ? { taskId: id } : { activityId: id }),
                },
          ),
        },
      );
    expect((await request("POST", "x".repeat(10_001))).status).toBe(400);
    expect(await app.db.find(ActivityEntity)).toHaveLength(0);
    const created = await request("POST", "x".repeat(10_000));
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    expect((await request("PUT", "x".repeat(10_001), id)).status).toBe(400);
    expect(await app.db.find(ActivityEntity)).toMatchObject([
      { id, content: "x".repeat(10_000) },
    ]);
    expect((await request("PUT", "edited", id)).status).toBe(200);
  },
);
