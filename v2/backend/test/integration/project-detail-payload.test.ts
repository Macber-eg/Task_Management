import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("project detail payload", () => {
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

  it("returns only project metadata even when the project has large tasks", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    await createTask(app.db, {
      projectId: project.id,
      title: "Task",
      description: "x".repeat(100_000),
    });
    app.auth.signIn(member.user);
    const response = await app.request(`/api/project/${project.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.id).toBe(project.id);
    expect(body).not.toHaveProperty("tasks");
    expect(body).not.toHaveProperty("backgroundObjectKey");
    expect(body).not.toHaveProperty("backgroundMimeType");
    expect(JSON.stringify(body).length).toBeLessThan(2000);
  });

  it("answers 404 for a project in a workspace the user does not belong to", async () => {
    const member = await createWorkspaceMember(app.db);
    const stranger = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(stranger.user);

    const response = await app.request(`/api/project/${project.id}`);
    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Project not found",
    });
  });
});
