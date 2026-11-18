import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationPluginRegistry } from "../../core/integration-plugin-registry";
import type { ChatTaskReader } from "../shared/chat-task-reader";
import { postToGenericWebhook } from "./generic-webhook-client";
import { GenericWebhookDelivery } from "./generic-webhook-delivery";
import type { GenericWebhookHealth } from "./generic-webhook-health";
import { GenericWebhookPlugin } from "./generic-webhook.plugin";

vi.mock("./generic-webhook-client", () => ({
  postToGenericWebhook: vi.fn(),
}));

const reader = {
  readTask: vi.fn(),
  readUser: vi.fn(),
  readProject: vi.fn(),
};
const health = { persist: vi.fn() };

function plugin() {
  return new GenericWebhookPlugin(
    {} as IntegrationPluginRegistry,
    new GenericWebhookDelivery(
      reader as unknown as ChatTaskReader,
      health as unknown as GenericWebhookHealth,
    ),
  );
}

const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    webhookUrl: "https://example.com/hooks/kaneo",
  },
};

const enabledContext = {
  ...context,
  config: {
    webhookUrl: "https://example.com/hooks/kaneo",
    events: { taskDeleted: true },
  },
};

const deletedEvent = {
  taskId: "task-1",
  projectId: "project-1",
  userId: "user-1",
  title: "Ship the release",
};

describe("generic webhook event handlers", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.mocked(postToGenericWebhook).mockReset();
    for (const mock of [...Object.values(reader), health.persist])
      mock.mockReset();
    health.persist.mockResolvedValue(undefined);
  });

  it("does not post task.unassigned when taskUnassigned is disabled", async () => {
    await plugin().onTaskUnassigned(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        title: "Ship the release",
      },
      context,
    );

    expect(postToGenericWebhook).not.toHaveBeenCalled();
  });

  it("does not post task.deleted when taskDeleted is disabled", async () => {
    await plugin().onTaskDeleted(deletedEvent, context);

    expect(postToGenericWebhook).not.toHaveBeenCalled();
  });

  it("posts a project-scoped task.deleted envelope when enabled", async () => {
    reader.readProject.mockResolvedValueOnce({
      id: "project-1",
      name: "Roadmap",
      workspaceId: "workspace-1",
    });
    reader.readUser.mockResolvedValueOnce({ id: "user-1", name: "Andrej" });

    await plugin().onTaskDeleted(deletedEvent, enabledContext);

    expect(postToGenericWebhook).toHaveBeenCalledTimes(1);
    const [url, payload] = vi.mocked(postToGenericWebhook).mock.calls[0] ?? [];
    expect(url).toBe("https://example.com/hooks/kaneo");
    expect(payload).toMatchObject({
      event: "task.deleted",
      integration: { type: "generic-webhook" },
      project: { id: "project-1", name: "Roadmap", workspaceId: "workspace-1" },
      task: { id: "task-1", title: "Ship the release" },
      actor: { id: "user-1", name: "Andrej" },
      data: {},
    });
  });

  it("does not log a credential-bearing URL or unknown transport error", async () => {
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    const secretUrl =
      "https://example.com/hooks/private-token?key=secret-value";
    reader.readProject.mockResolvedValueOnce({
      id: "project-1",
      name: "Roadmap",
      workspaceId: "workspace-1",
    });
    reader.readUser.mockResolvedValueOnce({ id: "user-1", name: "User" });
    vi.mocked(postToGenericWebhook).mockRejectedValueOnce(new Error(secretUrl));
    await plugin().onTaskDeleted(deletedEvent, {
      ...enabledContext,
      config: { ...enabledContext.config, webhookUrl: secretUrl },
    });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
    expect(JSON.stringify(log.mock.calls)).toContain("Outbound request failed");
  });

  it("skips task.deleted when the project row no longer exists", async () => {
    reader.readProject.mockResolvedValueOnce(undefined);

    await plugin().onTaskDeleted(deletedEvent, enabledContext);

    expect(postToGenericWebhook).not.toHaveBeenCalled();
  });
});
