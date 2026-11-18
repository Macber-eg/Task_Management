import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationPluginRegistry } from "../../core/integration-plugin-registry";
import type { ChatTaskReader } from "../shared/chat-task-reader";
import { TelegramPlugin } from "./telegram.plugin";

const m = vi.hoisted(() => ({
  readTask: vi.fn(),
  readUser: vi.fn(),
  send: vi.fn(),
}));
vi.mock("./telegram-client", () => ({ postToTelegram: m.send }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function plugin() {
  return new TelegramPlugin(
    {} as IntegrationPluginRegistry,
    { readTask: m.readTask, readUser: m.readUser } as unknown as ChatTaskReader,
  );
}

const event = {
  taskId: "task",
  projectId: "project",
  userId: "user",
  title: "Task",
  description: null,
  priority: null,
  status: "to-do",
  number: 1,
};
const token = `12345678:${"x".repeat(35)}`;

describe("Telegram logging", () => {
  it("does not log secret-bearing invalid configuration", async () => {
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    await plugin().onTaskCreated(event, {
      integrationId: "integration",
      projectId: "project",
      config: { botToken: token, chatId: "" },
    });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain("botToken");
    expect(m.readTask).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("discards unknown errors with token-bearing causes", async () => {
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    m.readTask.mockResolvedValueOnce({
      id: "task",
      title: "Task",
      number: 1,
      status: "to-do",
      priority: "low",
      columnName: null,
      projectName: "Project",
      workspaceId: "workspace",
      projectId: "project",
    });
    m.readUser.mockResolvedValueOnce({ id: "user", name: "User" });
    m.send.mockRejectedValue(
      new Error(`Failed https://api.telegram.org/bot${token}`, {
        cause: { token },
      }),
    );
    await plugin().onTaskCreated(event, {
      integrationId: "integration",
      projectId: "project",
      config: { botToken: token, chatId: "chat" },
    });
    expect(m.send).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).toContain("Outbound request failed");
  });
});
