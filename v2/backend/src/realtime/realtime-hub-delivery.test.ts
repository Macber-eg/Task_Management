import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHub,
  createRedisHub,
  type FakeReader,
  type FakeRedis,
  fakeReader,
  fakeRedis,
  fakeSocket,
  sentMessages,
} from "../../test/support/realtime-hub-fakes";
import type { RealtimeHub } from "./realtime-hub";

let reader: FakeReader;
let hub: RealtimeHub;

function connect(
  projectId: string,
  userId = "user-1",
  initiatorId = "init-1",
) {
  const socket = fakeSocket();
  hub.addProjectConnection(projectId, socket, {
    userId,
    initiatorId,
    workspaceId: "workspace",
    sessionId: null,
  });
  return socket;
}

beforeEach(() => {
  reader = fakeReader();
  reader.projectWorkspaceId.mockResolvedValue("workspace");
  reader.workspaceMemberIds.mockImplementation(async (_workspace, ids) => [
    ...ids,
  ]);
});

afterEach(async () => {
  await hub.stop();
  vi.useRealTimers();
});

describe("broadcastToProject", () => {
  beforeEach(async () => {
    hub = createHub(reader);
    await hub.start();
  });

  it("delivers messages to connected clients after batch timeout", async () => {
    const socket = connect("proj-1");
    hub.broadcastToProject("proj-1", {
      type: "TASK_CREATED",
      projectId: "proj-1",
      taskId: "t1",
    });
    expect(socket.send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(sentMessages(socket)[0]).toMatchObject({
      type: "TASK_CREATED",
      taskId: "t1",
    });
  });

  it("excludes connections matching excludeInitiatorId", async () => {
    const excluded = connect("proj-1", "user-1", "init-excluded");
    const other = connect("proj-1", "user-2", "init-other");
    hub.broadcastToProject(
      "proj-1",
      { type: "TASK_UPDATED", projectId: "proj-1" },
      "init-excluded",
    );
    await vi.waitFor(() => expect(other.send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(excluded.send).not.toHaveBeenCalled();
  });

  it("deduplicates messages with the same key in a batch window", async () => {
    const socket = connect("proj-1");
    for (let index = 0; index < 2; index++)
      hub.broadcastToProject("proj-1", {
        type: "TASK_UPDATED",
        projectId: "proj-1",
        taskId: "t1",
      });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled(), {
      timeout: 300,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("preserves a link refresh when a later unrelated update shares its batch", async () => {
    const socket = connect("proj-1");
    hub.broadcastToProject("proj-1", {
      type: "PROJECT_UPDATED",
      projectId: "proj-1",
      linksChanged: true,
    });
    hub.broadcastToProject("proj-1", {
      type: "PROJECT_UPDATED",
      projectId: "proj-1",
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce(), {
      timeout: 300,
    });
    expect(sentMessages(socket)[0]).toMatchObject({
      type: "PROJECT_UPDATED",
      projectId: "proj-1",
      linksChanged: true,
    });
  });

  it("does not deliver to connections on a different project", async () => {
    const socket = connect("proj-2");
    hub.broadcastToProject("proj-1", {
      type: "TASK_CREATED",
      projectId: "proj-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("stops delivering to a removed connection", async () => {
    const socket = connect("proj-1");
    const connection = hub.addProjectConnection("proj-1", fakeSocket(), {
      userId: "user-1",
      initiatorId: "init-2",
      workspaceId: "workspace",
      sessionId: null,
    });
    hub.removeProjectConnection("proj-1", connection);
    hub.removeProjectConnection("unknown", connection);
    hub.broadcastToProject("proj-1", {
      type: "TASK_CREATED",
      projectId: "proj-1",
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(connection.socket.send).not.toHaveBeenCalled();
  });

  it("warns when called before adapter initialization", async () => {
    await hub.stop();
    const warn = vi
      .spyOn(
        (hub as unknown as { logger: { warn: (message: string) => void } })
          .logger,
        "warn",
      )
      .mockImplementation(() => {});
    hub.broadcastToProject("proj-1", {
      type: "TASK_CREATED",
      projectId: "proj-1",
    });
    expect(warn).toHaveBeenCalledWith(
      "broadcastToProject called before adapter initialization",
    );
  });
});

it.each([1, 2])(
  "delivers %i reorder batches without merging them",
  async (batches) => {
    vi.useFakeTimers();
    hub = createHub(reader);
    await hub.start();
    const socket = connect("project", "observer", "window");
    const tasks = [
      { id: "one", position: 1, status: "to-do" },
      { id: "two", position: 0, status: "to-do" },
    ];
    for (let index = 0; index < batches; index++)
      hub.broadcastToProject("project", {
        type: "TASKS_REORDERED",
        projectId: "project",
        tasks,
      });
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.send).toHaveBeenCalledTimes(batches);
    expect(sentMessages(socket)[0]).toEqual({
      type: "TASKS_REORDERED",
      projectId: "project",
      tasks,
    });
  },
);

it("publishes what is still queued when it stops", async () => {
  const redis = fakeRedis();
  hub = createRedisHub(reader, redis);
  await hub.start();
  hub.broadcastToProject("project", {
    type: "TASK_UPDATED",
    projectId: "project",
    taskId: "t1",
  });
  await hub.stop();
  expect(redis.published()).toEqual([
    expect.objectContaining({
      channel: "kaneo:ws:project:broadcast",
      projectId: "project",
      message: { type: "TASK_UPDATED", projectId: "project", taskId: "t1" },
    }),
  ]);
  expect(redis.close).toHaveBeenCalled();
});

describe("broadcastToUser", () => {
  beforeEach(async () => {
    hub = createHub(reader);
    await hub.start();
  });

  it("delivers a message to every socket the user has open", () => {
    const first = fakeSocket();
    const second = fakeSocket();
    hub.addUserConnection("user-1", first);
    hub.addUserConnection("user-1", second);
    hub.broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    expect(sentMessages(first)).toEqual([{ type: "NOTIFICATION_CREATED" }]);
    expect(sentMessages(second)).toEqual([{ type: "NOTIFICATION_CREATED" }]);
  });

  it("does not deliver a message to a different user", () => {
    const mine = fakeSocket();
    const theirs = fakeSocket();
    hub.addUserConnection("user-1", mine);
    hub.addUserConnection("user-2", theirs);
    hub.broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    expect(mine.send).toHaveBeenCalled();
    expect(theirs.send).not.toHaveBeenCalled();
  });

  it("still delivers locally when no adapter is initialised", async () => {
    await hub.stop();
    const socket = fakeSocket();
    hub.addUserConnection("user-1", socket);
    hub.broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    expect(socket.send).toHaveBeenCalled();
  });
});

describe("broadcastToUser with the redis adapter", () => {
  let redis: FakeRedis;
  const userPattern = "kaneo:ws-user:*:broadcast";

  beforeEach(async () => {
    redis = fakeRedis();
    hub = createRedisHub(reader, redis);
    await hub.start();
  });

  it("delivers to local sockets without waiting on redis", () => {
    const socket = fakeSocket();
    hub.addUserConnection("user-1", socket);
    hub.broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    expect(sentMessages(socket)).toEqual([{ type: "NOTIFICATION_CREATED" }]);
  });

  it("still delivers locally when the publish fails", async () => {
    redis.publish.mockRejectedValue(new Error("redis is down"));
    const socket = fakeSocket();
    hub.addUserConnection("user-1", socket);
    hub.broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("ignores its own echo so the socket is written once", () => {
    const socket = fakeSocket();
    hub.addUserConnection("user-1", socket);
    hub.broadcastToUser("user-1", { type: "NOTIFICATION_CREATED" });
    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [published] = redis.published();
    expect(published?.origin).toEqual(expect.any(String));
    redis.emit(userPattern, "kaneo:ws-user:user-1:broadcast", {
      userId: published?.userId,
      message: published?.message,
      origin: published?.origin,
    });
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("delivers a broadcast published by another instance", () => {
    const socket = fakeSocket();
    hub.addUserConnection("user-1", socket);
    redis.emit(userPattern, "kaneo:ws-user:user-1:broadcast", {
      userId: "user-1",
      message: { type: "NOTIFICATION_CREATED" },
      origin: "some-other-instance",
    });
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("drops a message whose payload disagrees with its channel", () => {
    const socket = fakeSocket();
    hub.addUserConnection("user-1", socket);
    redis.emit(userPattern, "kaneo:ws-user:user-2:broadcast", {
      userId: "user-1",
      message: { type: "NOTIFICATION_CREATED" },
      origin: "some-other-instance",
    });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("resynchronizes healthy browser sockets after the subscriber recovers", async () => {
    const sync = vi.spyOn(hub, "syncWorkspaceAccess").mockResolvedValue();
    const socket = fakeSocket();
    const connection = hub.addUserConnection("user-1", socket);
    redis.ready();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("user-1", socket));
    hub.removeUserConnection("user-1", connection);
    await hub.stop();
    sync.mockClear();
    redis.ready();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync).not.toHaveBeenCalled();
  });

  it("ignores an offline-queued revocation after the member regains access", async () => {
    reader.hasWorkspaceAccess.mockResolvedValue(true);
    const tab = fakeSocket();
    const board = fakeSocket();
    hub.addUserConnection("user-1", tab);
    hub.addProjectConnection("project", board, {
      userId: "user-1",
      initiatorId: "window",
      workspaceId: "workspace",
      sessionId: null,
    });
    const revocation = {
      userId: "user-1",
      origin: "other-instance",
      message: { type: "WORKSPACE_ACCESS_REVOKED", workspaceId: "workspace" },
    };
    redis.emit(userPattern, "kaneo:ws-user:user-1:broadcast", revocation);
    await vi.waitFor(() =>
      expect(reader.hasWorkspaceAccess).toHaveBeenCalledWith(
        "user-1",
        "workspace",
      ),
    );
    await Promise.resolve();
    expect(tab.send).not.toHaveBeenCalled();
    expect(board.close).not.toHaveBeenCalled();

    reader.hasWorkspaceAccess.mockResolvedValue(false);
    redis.emit(userPattern, "kaneo:ws-user:user-1:broadcast", revocation);
    await vi.waitFor(() => expect(tab.send).toHaveBeenCalledOnce());
    expect(board.close).toHaveBeenCalledWith(1008, "Workspace access revoked");
  });

  it.each([true, false])(
    "retries incoming revocation validation without evicting on database errors (restored=%s)",
    async (restored) => {
      await hub.stop();
      vi.useFakeTimers();
      redis = fakeRedis();
      hub = createRedisHub(reader, redis);
      await hub.start();
      reader.hasWorkspaceAccess.mockRejectedValue(
        new Error("database unavailable"),
      );
      const tab = fakeSocket();
      const board = fakeSocket();
      hub.addUserConnection("user-1", tab);
      hub.addProjectConnection("project", board, {
        userId: "user-1",
        initiatorId: "window",
        workspaceId: "workspace",
        sessionId: null,
      });
      redis.emit(userPattern, "kaneo:ws-user:user-1:broadcast", {
        userId: "user-1",
        origin: "other-instance",
        message: { type: "WORKSPACE_ACCESS_REVOKED", workspaceId: "workspace" },
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(tab.send).not.toHaveBeenCalled();
      expect(board.close).not.toHaveBeenCalled();
      reader.hasWorkspaceAccess.mockResolvedValue(restored);
      await vi.advanceTimersByTimeAsync(2000);
      expect(tab.send).toHaveBeenCalledTimes(restored ? 0 : 1);
      if (!restored)
        expect(board.close).toHaveBeenCalledWith(
          1008,
          "Workspace access revoked",
        );
    },
  );
});
