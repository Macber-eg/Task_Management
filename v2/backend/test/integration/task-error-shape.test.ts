import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createUnseededWorkspaceMember } from "../support/fixtures/task-d-unseeded-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from the previous `error-shape` suite: the cases it probed through
// task creation. The API key is presented as an authenticated principal
// carrying its scope, which is what the real authenticator produces.
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

function createTask(projectId: string, body: unknown) {
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validTask = {
  title: "Error shape probe",
  description: "",
  priority: "low",
  status: "to-do",
};

async function memberWithProject(role: string) {
  const member = await createUnseededWorkspaceMember(app.db, role);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  return { ...member, project };
}

describe("API integration: task error shape", () => {
  it("reports every validation issue under VALIDATION_ERROR", async () => {
    const { user, project } = await memberWithProject("member");
    app.auth.signIn(user);

    const response = await createTask(project.id, {
      priority: "urgent-ish",
      status: 5,
    });

    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.code).toBe("VALIDATION_ERROR");
    const paths = body.issues?.map((issue) => issue.path) ?? [];
    expect(paths).toEqual(
      expect.arrayContaining([
        "body.title",
        "body.description",
        "body.priority",
        "body.status",
      ]),
    );
    const [first] = body.issues ?? [];
    expect(body.message).toBe(
      `${first?.path.replace(/^body\./, "")}: ${first?.message}`,
    );
  });

  it("names the permissions a member lacks", async () => {
    const { user, project } = await memberWithProject("viewer");
    app.auth.signIn(user);

    const response = await createTask(project.id, validTask);

    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toEqual({
      message: "Insufficient permissions",
      code: "MISSING_PERMISSION",
      missingPermissions: ["task:create"],
    });
  });

  it("names the permissions an API key's scope lacks", async () => {
    const { user, project } = await memberWithProject("member");
    app.auth.signInAs(
      await createApiKeyPrincipal(app.db, user, { task: ["read"] }),
    );

    const response = await createTask(project.id, validTask);

    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toEqual({
      message: "Insufficient API key scope",
      code: "API_KEY_SCOPE",
      missingPermissions: ["task:create"],
    });
  });
});
