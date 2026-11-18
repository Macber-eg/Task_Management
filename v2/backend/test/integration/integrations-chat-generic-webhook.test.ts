import { createHmac } from "node:crypto";
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
import { TaskReminderSentEntity } from "../../src/database/entities/task-reminder-sent.entity";
import { EventBus } from "../../src/events/event-bus";
import { ProjectWebhookReminders } from "../../src/integrations/chat/generic-webhook/project-webhook-reminders";
import { JobScheduler } from "../../src/scheduler/job-scheduler";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { createTestApp } from "../support/test-app";
import { startWebhookServer } from "../support/fixtures/integrations-chat-webhook-server";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import type { TestApp } from "../support/test-app";

// Not in the previous suite beyond unit tests of the handlers: these pin the
// settings routes, the signed delivery, health tracking and the reminder job.
describe("API integration: generic webhook", () => {
  let app: TestApp;
  let server: Awaited<ReturnType<typeof startWebhookServer>>;

  beforeAll(async () => {
    app = await createTestApp();
    server = await startWebhookServer();
  });

  afterAll(async () => {
    await server.close();
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    server.received.length = 0;
    server.respondWith(200);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function setup(role = "owner") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Roadmap",
    });
    app.auth.signIn(member.user);
    const path = `/api/generic-webhook-integration/project/${project.id}`;
    const request = (method: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { ...member, project, columns, request };
  }

  async function readConfig(projectId: string) {
    const row = await app.db.findOneOrFail(IntegrationEntity, {
      where: { projectId, type: "generic-webhook" },
    });
    return JSON.parse(row.config) as Record<string, unknown> & {
      health?: Record<string, unknown>;
    };
  }

  it("stores, masks, merges and removes the webhook settings", async () => {
    const { project, request } = await setup();
    const url = server.url("/hooks/kaneo-private");

    expect(await (await request("GET")).json()).toBeNull();
    const invalid = await request("POST", { webhookUrl: "not a url" });
    expect(invalid.status).toBe(400);
    expect((await readErrorBody(invalid)).message).toBe("Invalid URL");
    expect(
      (await request("POST", { webhookUrl: url, dueDateReminderLeadTimeMinutes: 1 }))
        .status,
    ).toBe(400);

    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const privateUrl = await request("POST", { webhookUrl: url });
    expect(privateUrl.status).toBe(400);
    expect((await readErrorBody(privateUrl)).message).toBe(
      "Generic webhook destination resolves to a non-routable address",
    );
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");

    const created = await request("POST", {
      webhookUrl: url,
      secret: "  signing-secret  ",
      events: { taskDeleted: true },
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      projectId: project.id,
      webhookConfigured: true,
      maskedWebhookUrl: "http…vate",
      secretConfigured: true,
      maskedSecret: "sign…cret",
      dueDateReminderLeadTimeMinutes: 1440,
      isActive: true,
      events: { taskCreated: true, taskDeleted: true, dueDateReminder: false },
    });
    expect(JSON.stringify(body)).not.toContain("signing-secret");
    expect(await readConfig(project.id)).toMatchObject({
      webhookUrl: url,
      secret: "signing-secret",
    });

    const updated = await request("PATCH", {
      secret: null,
      isActive: false,
      events: { taskCreated: false },
      dueDateReminderLeadTimeMinutes: 60,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: body.id,
      secretConfigured: false,
      maskedSecret: null,
      isActive: false,
      dueDateReminderLeadTimeMinutes: 60,
      events: { taskCreated: false, taskDeleted: true },
    });

    expect((await request("DELETE")).status).toBe(200);
    expect(await (await request("GET")).json()).toBeNull();
    const missing = await request("PATCH", { isActive: true });
    expect(missing.status).toBe(404);
    expect((await readErrorBody(missing)).message).toBe(
      "Generic webhook integration not found",
    );
  });

  it("refuses settings changes without workspace:manage_settings", async () => {
    const { request } = await setup("viewer");
    expect((await request("GET")).status).toBe(200);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const response = await request(
        method,
        method === "DELETE" ? undefined : { webhookUrl: server.url("/x") },
      );
      expect(response.status).toBe(403);
    }
  });

  it("signs deliveries and records their health", async () => {
    const { project, user, workspace, request, columns } = await setup();
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Ship",
      number: 3,
      columnId: columns.inProgress.id,
      status: "in-progress",
    });
    await request("POST", {
      webhookUrl: server.url("/hooks/kaneo"),
      secret: "signing-secret",
    });

    const received = server.next();
    await app.get(EventBus).publish("task.status_changed", {
      taskId: task.id,
      projectId: project.id,
      userId: user.id,
      oldStatus: "to-do",
      newStatus: "in-progress",
      title: "Ship",
      type: "status_changed",
    }, { waitForHandlers: true });
    const delivery = await received;

    expect(delivery.headers["x-kaneo-signature"]).toBe(
      createHmac("sha256", "signing-secret").update(delivery.body).digest("hex"),
    );
    expect(JSON.parse(delivery.body)).toEqual({
      event: "task.status_changed",
      timestamp: expect.any(String),
      integration: { type: "generic-webhook" },
      project: { id: project.id, name: "Roadmap", workspaceId: workspace.id },
      task: {
        id: task.id,
        number: 3,
        title: "Ship",
        status: "in-progress",
        statusName: "In Progress",
        priority: task.priority,
        url: expect.stringContaining(`/project/${project.id}/task/${task.id}`),
      },
      actor: { id: user.id, name: user.name },
      data: { title: "Ship", oldStatus: "to-do", newStatus: "in-progress" },
    });
    await vi.waitFor(async () =>
      expect((await readConfig(project.id)).health).toMatchObject({
        lastSuccessAt: expect.any(String),
        lastAttempt: {
          eventName: "task.status_changed",
          taskId: task.id,
          projectId: project.id,
          webhookUrl: "configured destination",
        },
      }),
    );

    server.respondWith(500);
    const failed = server.next();
    await app.get(EventBus).publish("comment.created", {
      taskId: task.id,
      projectId: project.id,
      userId: user.id,
      comment: "hello",
    }, { waitForHandlers: true });
    await failed;
    await vi.waitFor(async () =>
      expect((await readConfig(project.id)).health).toMatchObject({
        lastFailureMessage: "Outbound request failed: http (HTTP 500)",
        failureCount: 1,
        lastAttempt: { eventName: "task.comment_created" },
      }),
    );
  });

  it("sends each due-date reminder once and retries a failed delivery", async () => {
    const { project, request } = await setup();
    expect(
      app
        .get(JobScheduler)
        .jobs()
        .some((job) => job.name === "project-webhook-reminders"),
    ).toBe(true);
    await request("POST", {
      webhookUrl: server.url("/hooks/reminders"),
      events: { dueDateReminder: true },
      dueDateReminderLeadTimeMinutes: 60,
    });
    const now = new Date();
    // Its due day ends in 55 minutes: inside the 60-minute lead time window.
    const dueDate = new Date(now.getTime() + 55 * 60_000 - 24 * 60 * 60_000);
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Due soon",
      dueDate,
    });
    await createTask(app.db, {
      projectId: project.id,
      title: "Archived",
      number: 2,
      status: "archived",
      dueDate,
    });
    const integration = await app.db.findOneOrFail(IntegrationEntity, {
      where: { projectId: project.id },
    });
    const reminders = app.get(ProjectWebhookReminders);
    const sentRows = () =>
      app.db.find(TaskReminderSentEntity, {
        where: { reminderType: `generic_webhook:${integration.id}` },
      });

    server.respondWith(503);
    expect(await reminders.checkProjectWebhookReminders(now)).toEqual({
      degraded: false,
    });
    expect(server.received).toHaveLength(1);
    expect(await sentRows()).toHaveLength(0);

    server.respondWith(200);
    await reminders.checkProjectWebhookReminders(now);
    await reminders.checkProjectWebhookReminders(now);
    expect(server.received).toHaveLength(2);
    expect(JSON.parse(server.received[1]!.body)).toMatchObject({
      event: "task.due_date_reminder",
      task: { id: task.id, title: "Due soon" },
      actor: { id: null, name: null },
      data: { dueDate: dueDate.toISOString(), leadTimeMinutes: 60 },
    });
    expect(await sentRows()).toEqual([
      expect.objectContaining({ taskId: task.id }),
    ]);
  });

  it("reads configs and secrets written by the previous backend", async () => {
    const { project, request } = await setup();
    await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "generic-webhook",
      isActive: true,
      config: JSON.stringify({
        webhookUrl: server.url("/legacy-hook"),
        secret: "legacy-secret",
        events: { taskCreated: true },
      }),
    });

    expect(await (await request("GET")).json()).toMatchObject({
      secretConfigured: true,
      maskedSecret: "lega…cret",
      dueDateReminderLeadTimeMinutes: 1440,
      events: { taskCreated: true, taskStatusChanged: true },
    });
  });
});
