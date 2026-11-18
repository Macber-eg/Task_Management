import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
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

async function importTitles(projectId: string, titles: string[]) {
  const response = await app.request(`/api/task/import/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tasks: titles.map((title) => ({ title, status: "to-do" })),
    }),
  });
  expect(response.status).toBe(200);
}

describe("task import", () => {
  it("keeps the file order and appends after existing tasks", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });

    app.auth.signIn(user);

    await importTitles(project.id, ["First", "Second", "Third"]);
    await importTitles(project.id, ["Fourth"]);

    const stored = await app.db.find(TaskEntity, {
      select: { title: true, position: true },
      where: { projectId: project.id },
      order: { position: "ASC" },
    });

    expect(stored.map((task) => task.title)).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
    ]);
    expect(new Set(stored.map((task) => task.position)).size).toBe(4);
  });
});
