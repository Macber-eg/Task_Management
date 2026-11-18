import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { EventBus } from "../../src/events/event-bus";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { createTestApp } from "../support/test-app";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import type { TestApp } from "../support/test-app";

// Not in the previous suite: Slack, Discord and Telegram settings routes and
// delivery. Their hosts are fixed, so only requests to them are intercepted.
const slackUrl =
  "https://hooks.slack.com/services/T0000/B0000/abcdefghijkl";
const discordUrl =
  "https://discord.com/api/webhooks/123456/abcdefghijklmnop";
const botToken = `12345678:${"abcd"}${"x".repeat(27)}wxyz`;
const fixedHosts = [
  "https://hooks.slack.com/",
  "https://discord.com/",
  "https://api.telegram.org/",
];

describe("API integration: Slack, Discord and Telegram", () => {
  let app: TestApp;
  const realFetch = globalThis.fetch;
  const outbound: { url: string; body: unknown }[] = [];
  let publish: MockInstance<EventBus["publish"]>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    outbound.length = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        input instanceof Request ? input.url : (input as string | URL).toString();
      if (!fixedHosts.some((host) => url.startsWith(host)))
        return realFetch(input, init);
      outbound.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    publish = vi.spyOn(app.get(EventBus), "publish");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup(role = "owner") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Roadmap",
    });
    app.auth.signIn(member.user);
    const request =
      (name: string) =>
      (method: string, body?: unknown): Promise<Response> =>
        app.request(`/api/${name}-integration/project/${project.id}`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
    return { ...member, project, request };
  }

  async function publishTaskCreated(
    projectId: string,
    userId: string,
    title = "Ship <it>",
  ) {
    const task = await createTask(app.db, { projectId, title, number: 4 });
    await app.get(EventBus).publish("task.created", {
      taskId: task.id,
      projectId,
      userId,
      title,
      description: null,
      priority: "low",
      status: "to-do",
      number: 4,
    }, { waitForHandlers: true });
    return task;
  }

  it("manages the Slack integration with a masked webhook", async () => {
    const { project, request } = await setup();
    const slack = request("slack");

    expect(await (await slack("GET")).json()).toBeNull();
    const invalid = await slack("POST", {
      webhookUrl: "https://example.com/hook",
    });
    expect(invalid.status).toBe(400);
    expect((await readErrorBody(invalid)).message).toBe(
      "Invalid Slack webhook URL",
    );

    const created = await slack("POST", {
      webhookUrl: slackUrl,
      channelName: " #eng ",
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      projectId: project.id,
      channelName: "#eng",
      webhookConfigured: true,
      maskedWebhookUrl:
        "https://hooks.slack.com/services/T0000/B0000/abcd…ijkl",
      isActive: true,
      events: {
        taskCreated: true,
        taskStatusChanged: true,
        taskPriorityChanged: false,
        taskTitleChanged: false,
        taskDescriptionChanged: false,
        taskCommentCreated: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain(slackUrl);

    // An empty URL keeps the stored one.
    const updated = await slack("PATCH", {
      webhookUrl: "",
      events: { taskPriorityChanged: true },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: body.id,
      events: { taskCreated: true, taskPriorityChanged: true },
    });
    const stored = await app.db.findOneOrFail(IntegrationEntity, {
      where: { id: body.id as string },
    });
    expect(JSON.parse(stored.config).webhookUrl).toBe(slackUrl);

    expect((await slack("DELETE")).status).toBe(200);
    const missing = await slack("DELETE");
    expect(missing.status).toBe(404);
    expect((await readErrorBody(missing)).message).toBe(
      "Slack integration not found",
    );
  });

  it("upserts the Discord integration and validates its URL", async () => {
    const { request } = await setup();
    const discord = request("discord");

    const invalid = await discord("POST", { webhookUrl: "nope" });
    expect(invalid.status).toBe(400);
    expect((await readErrorBody(invalid)).message).toBe(
      'Invalid URL: Received "nope", Enter a valid Discord webhook URL',
    );
    const first = (await (
      await discord("POST", { webhookUrl: discordUrl })
    ).json()) as Record<string, unknown>;
    expect(first).toMatchObject({
      maskedWebhookUrl: "https://discord.com/api/webhooks/123456/abcd…mnop",
      channelName: null,
      isActive: true,
    });
    await discord("PATCH", { isActive: false });
    const replaced = (await (
      await discord("POST", { webhookUrl: discordUrl, channelName: "ops" })
    ).json()) as Record<string, unknown>;
    expect(replaced).toMatchObject({
      id: first.id,
      channelName: "ops",
      isActive: true,
    });
    expect((await discord("DELETE")).status).toBe(200);
    const missing = await discord("PATCH", { isActive: true });
    expect(missing.status).toBe(404);
    expect((await readErrorBody(missing)).message).toBe(
      "Discord integration not found",
    );
  });

  it("manages the Telegram integration and publishes integration events", async () => {
    const { project, user, request } = await setup();
    const telegram = request("telegram");

    const invalid = await telegram("POST", { botToken: "bad", chatId: "1" });
    expect(invalid.status).toBe(400);
    expect((await readErrorBody(invalid)).message).toBe(
      "Enter a valid Telegram bot token",
    );

    const created = await telegram("POST", {
      botToken,
      chatId: "-100200",
      threadId: 5,
      chatLabel: " Team ",
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      projectId: project.id,
      chatId: "-100200",
      threadId: 5,
      chatLabel: "Team",
      botTokenConfigured: true,
      maskedBotToken: "12345678:abcd…wxyz",
      isActive: true,
    });
    expect(JSON.stringify(body)).not.toContain(botToken);
    const integrationEvent = {
      projectId: project.id,
      userId: user.id,
      integrationType: "telegram",
      integrationId: body.id,
    };
    expect(publish).toHaveBeenCalledWith(
      "integration.created",
      integrationEvent,
    );

    publish.mockClear();
    const unchanged = await telegram("PATCH", { chatLabel: "Team" });
    expect(await unchanged.json()).toMatchObject({ id: body.id });
    expect(publish).not.toHaveBeenCalledWith(
      "integration.updated",
      expect.anything(),
    );

    const cleared = await telegram("PATCH", {
      threadId: null,
      chatLabel: null,
      events: { taskCreated: false },
    });
    expect(await cleared.json()).toMatchObject({
      threadId: null,
      chatLabel: null,
      events: { taskCreated: false, taskCommentCreated: true },
    });
    expect(publish).toHaveBeenCalledWith(
      "integration.updated",
      integrationEvent,
    );
    expect(
      (await telegram("PATCH", { chatId: "   " })).status,
    ).toBe(400);

    expect((await telegram("DELETE")).status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      "integration.deleted",
      integrationEvent,
    );
  });

  it("answers 500 without secrets for a corrupt stored Telegram config", async () => {
    const { project, request } = await setup();
    await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "telegram",
      isActive: true,
      config: JSON.stringify({ botToken, chatId: "" }),
    });

    const response = await request("telegram")("GET");
    expect(response.status).toBe(500);
    const error = await readErrorBody(response);
    expect(error.message).toBe(
      "Stored Telegram integration configuration is invalid",
    );
    expect(JSON.stringify(error)).not.toContain(botToken);
  });

  it("refuses settings changes without workspace:manage_settings", async () => {
    const { request } = await setup("viewer");
    for (const name of ["slack", "discord", "telegram"]) {
      expect((await request(name)("GET")).status).toBe(200);
      for (const method of ["POST", "PATCH", "DELETE"]) {
        const response = await request(name)(
          method,
          method === "DELETE"
            ? undefined
            : { webhookUrl: slackUrl, botToken, chatId: "1" },
        );
        expect(response.status).toBe(403);
      }
    }
  });

  it("delivers enabled task events to Slack, Discord and Telegram", async () => {
    const { project, user, request } = await setup();
    await request("slack")("POST", { webhookUrl: slackUrl });
    await request("discord")("POST", { webhookUrl: discordUrl });
    await request("telegram")("POST", { botToken, chatId: "-100200" });

    await publishTaskCreated(project.id, user.id);
    await vi.waitFor(() => expect(outbound).toHaveLength(3));

    const byHost = (host: string) =>
      outbound.find((entry) => entry.url.startsWith(host));
    expect(byHost("https://hooks.slack.com/")).toMatchObject({
      url: slackUrl,
      body: {
        text: "New task created: Ship <it>",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*New task created*\nA new task was added: *Ship &lt;it&gt;*",
            },
          },
          { type: "context" },
        ],
      },
    });
    expect(byHost("https://discord.com/")).toMatchObject({
      url: discordUrl,
      body: {
        content: "New task created: #4 Ship <it>",
        embeds: [
          {
            title: "New task created",
            description: "A new task was added: **Ship <it>**",
            fields: expect.arrayContaining([
              { name: "Status", value: "To Do", inline: true },
            ]),
          },
        ],
      },
    });
    expect(byHost("https://api.telegram.org/")).toMatchObject({
      url: `https://api.telegram.org/bot${botToken}/sendMessage`,
      body: {
        chat_id: "-100200",
        parse_mode: "HTML",
        disable_web_page_preview: false,
        text: expect.stringContaining(
          "<b>New task created</b>\nA new task was added: Ship &lt;it&gt;",
        ),
      },
    });

    // Disabled events are not delivered.
    outbound.length = 0;
    await app.get(EventBus).publish("task.priority_changed", {
      taskId: (await createTask(app.db, { projectId: project.id, number: 9 }))
        .id,
      projectId: project.id,
      userId: user.id,
      oldPriority: "low",
      newPriority: "high",
      title: "Seed",
    }, { waitForHandlers: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(outbound).toHaveLength(0);
  });
});
