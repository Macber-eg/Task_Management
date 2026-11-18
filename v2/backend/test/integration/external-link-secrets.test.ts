import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const GITEA_TOKEN = "gitea-pat-should-never-be-exposed";
const WEBHOOK_SECRET = "gitea-webhook-secret-should-never-be-exposed";

describe("API integration: external link integration secrets", () => {
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

  it("does not expose integration config to a workspace viewer", async () => {
    const viewer = await createWorkspaceMember(app.db, { role: "viewer" });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: viewer.workspace.id,
    });

    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Task with a linked Gitea issue",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });

    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitea",
      config: JSON.stringify({
        baseUrl: "https://gitea.example",
        accessToken: GITEA_TOKEN,
        repositoryOwner: "owner",
        repositoryName: "repo",
        webhookSecret: WEBHOOK_SECRET,
      }),
      isActive: true,
    });

    await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://gitea.example/owner/repo/issues/1",
      title: "Linked issue",
      metadata: JSON.stringify({ state: "open" }),
    });

    app.auth.signIn(viewer.user);

    const response = await app.request(`/api/external-link/task/${task.id}`);

    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).not.toContain(GITEA_TOKEN);
    expect(body).not.toContain(WEBHOOK_SECRET);
    expect(body).not.toContain("config");

    const links = JSON.parse(body) as Record<string, unknown>[];
    expect(links).toHaveLength(1);
    expect(links[0]?.integration).toEqual({
      id: integration.id,
      type: "gitea",
    });
    expect(links[0]?.metadata).toEqual({ state: "open" });
  });
});
