import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { EventBus } from "../../src/events/event-bus";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { createTestApp } from "../support/test-app";
import { startWebhookServer } from "../support/fixtures/integrations-chat-webhook-server";
import { resetTestDatabase } from "../support/reset-test-database";
import type { TestApp } from "../support/test-app";

const webhookUrl = "https://127.0.0.1/hooks/mattermost-secret-token";

describe("API integration: Mattermost", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves webhook validation and settings across the OpenAPI routes", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });
    app.auth.signIn(owner.user);
    const path = `/api/mattermost-integration/project/${project.id}`;
    const request = (method: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    expect(await (await request("GET")).json()).toBeNull();
    expect(
      (await request("POST", { webhookUrl: "http://127.0.0.1/hooks/test" }))
        .status,
    ).toBe(400);
    const created = await request("POST", {
      webhookUrl,
      channelName: " Test channel ",
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      projectId: project.id,
      channelName: "Test channel",
      webhookConfigured: true,
      isActive: true,
      events: {
        taskCreated: true,
        taskStatusChanged: true,
        taskCommentCreated: true,
        taskPriorityChanged: false,
      },
    });
    expect(JSON.stringify(body)).not.toContain(webhookUrl);
    expect(body.createdAt).toEqual(expect.any(String));

    const updated = await request("PATCH", {
      isActive: false,
      channelName: null,
      events: { taskCreated: false },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      isActive: false,
      channelName: null,
      events: {
        taskCreated: false,
        taskStatusChanged: true,
        taskCommentCreated: true,
      },
    });
    expect((await request("PATCH", { webhookUrl: "" })).status).toBe(400);
    const stored = await app.db.findOne(IntegrationEntity, {
      where: { id: body.id as string },
    });
    if (!stored) throw new Error("Mattermost integration was not persisted");
    expect(JSON.parse(stored.config).webhookUrl).toBe(webhookUrl);
    expect(stored.isActive).toBe(false);

    const replaced = await request("POST", { webhookUrl });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      id: body.id,
      isActive: true,
    });
    expect((await request("DELETE")).status).toBe(200);
    expect(await (await request("GET")).json()).toBeNull();
    expect((await request("PATCH", { isActive: true })).status).toBe(404);
    expect((await request("DELETE")).status).toBe(404);
  });

  it("retains workspace permission checks for mutations", async () => {
    const viewer = await createWorkspaceMember(app.db, { role: "viewer" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: viewer.workspace.id,
    });
    app.auth.signIn(viewer.user);
    const path = `/api/mattermost-integration/project/${project.id}`;
    expect((await app.request(path)).status).toBe(200);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const response = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify({ webhookUrl }),
      });
      expect(response.status).toBe(403);
    }
  });

  // Not in the previous suite: the delivery path through the event dispatch.
  it("posts an escaped attachment for an enabled task event", async () => {
    const server = await startWebhookServer();
    try {
      const owner = await createWorkspaceMember(app.db, {
        role: "owner",
        userName: "Ada <Admin>",
      });
      const { project } = await createProjectFixture(app.db, {
        workspaceId: owner.workspace.id,
        name: "Roadmap",
      });
      const task = await createTask(app.db, {
        projectId: project.id,
        title: "Ship & tell",
        number: 7,
        priority: "high",
      });
      // Stored directly: route validation only admits https destinations.
      await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "mattermost",
        isActive: true,
        config: JSON.stringify({ webhookUrl: server.url("/hooks/mm") }),
      });

      const received = server.next();
      await app.get(EventBus).publish("task.created", {
        taskId: task.id,
        projectId: project.id,
        userId: owner.user.id,
        title: task.title,
        description: null,
        priority: "high",
        status: "to-do",
        number: 7,
      }, { waitForHandlers: true });
      const request = await received;

      expect(request.path).toBe("/hooks/mm");
      expect(request.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(request.body)).toEqual({
        text: "New task created: Ship & tell",
        attachments: [
          {
            color: "#4f46e5",
            title: "#7 Ship &amp; tell",
            title_link: expect.stringContaining(
              `/dashboard/workspace/${owner.workspace.id}/project/${project.id}/task/${task.id}`,
            ),
            text: "A new task was added: Ship &amp; tell",
            fields: [
              { title: "Project", value: "Roadmap", short: true },
              { title: "Status", value: "To Do", short: true },
              { title: "Priority", value: "High", short: true },
              {
                title: "Triggered by",
                value: "Ada &lt;Admin&gt;",
                short: true,
              },
            ],
          },
        ],
      });
    } finally {
      await server.close();
    }
  });
});
