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

const update = {
  type: "TASK_UPDATED",
  projectId: "project",
  taskId: "private-task",
};

let reader: FakeReader;
let redis: FakeRedis;
let hub: RealtimeHub;

async function start(useRedis = false) {
  hub = useRedis ? createRedisHub(reader, redis) : createHub(reader);
  await hub.start();
}

function connect(projectId = "project", workspaceId = "old", userId = "user") {
  const socket = fakeSocket();
  hub.addProjectConnection(projectId, socket, {
    userId,
    initiatorId: "window",
    workspaceId,
    sessionId: null,
  });
  return socket;
}

beforeEach(() => {
  reader = fakeReader();
  redis = fakeRedis();
  hub = createHub(reader);
});

afterEach(async () => {
  await hub.stop();
  vi.useRealTimers();
});

describe("project move revocation", () => {
  it("closes local connections and discards queued updates without touching another project", async () => {
    vi.useFakeTimers();
    await start();
    const old = connect();
    const other = connect("other");
    hub.broadcastToProject("project", update);
    await hub.closeProjectConnections("project");
    await vi.advanceTimersByTimeAsync(100);
    expect(old.close).toHaveBeenCalledWith(1008, "Project workspace changed");
    expect(sentMessages(old).map((message) => message.type)).toEqual([
      "PROJECT_MOVED",
    ]);
    expect(other.close).not.toHaveBeenCalled();
  });

  it("rejects stale workspace connections even when revocation was missed", async () => {
    vi.useFakeTimers();
    await start();
    const old = connect();
    const current = connect("project", "new");
    reader.projectWorkspaceId.mockResolvedValue("new");
    hub.broadcastToProject("project", update);
    await vi.advanceTimersByTimeAsync(100);
    expect(old.send).not.toHaveBeenCalled();
    expect(old.close).toHaveBeenCalled();
    expect(current.send).toHaveBeenCalledWith(JSON.stringify(update));
  });

  it.each([
    "projectWorkspaceId",
    "workspaceMemberIds",
    "usersWithProjectAccess",
  ] as const)(
    "skips delivery without revoking access on transient %s failure",
    async (lookup) => {
      vi.useFakeTimers();
      await start();
      const old = connect();
      reader[lookup].mockRejectedValueOnce(new Error("Database unavailable"));
      hub.broadcastToProject("project", update);
      await vi.advanceTimersByTimeAsync(100);
      expect(old.send).not.toHaveBeenCalled();
      expect(old.close).not.toHaveBeenCalled();
      hub.broadcastToProject("project", update);
      await vi.advanceTimersByTimeAsync(100);
      expect(old.send).toHaveBeenCalledWith(JSON.stringify(update));
    },
  );

  it("does not send an in-flight update after local revocation", async () => {
    vi.useFakeTimers();
    await start();
    const old = connect();
    let finish!: (value: string) => void;
    reader.projectWorkspaceId.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    hub.broadcastToProject("project", update);
    await vi.advanceTimersByTimeAsync(100);
    await hub.closeProjectConnections("project");
    finish("old");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentMessages(old).map((message) => message.type)).toEqual([
      "PROJECT_MOVED",
    ]);
  });

  it("revokes sockets when a move arrives through Redis", async () => {
    await start(true);
    const old = connect();
    redis.emit("kaneo:ws:*:broadcast", "kaneo:ws:project:broadcast", {
      projectId: "project",
      message: { type: "PROJECT_MOVED", projectId: "project" },
    });
    expect(old.close).toHaveBeenCalled();
  });

  it("closes local sockets even if Redis publication fails", async () => {
    await start(true);
    const old = connect();
    redis.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
    await expect(hub.closeProjectConnections("project")).resolves.toBeUndefined();
    expect(old.close).toHaveBeenCalled();
  });
});

describe("workspace membership revocation", () => {
  it("preserves instance-admin access after membership removal, but forces account revocation", async () => {
    await start();
    const socket = connect();
    reader.userRole.mockResolvedValue({ role: "user,admin" });
    await hub.revokeWorkspaceConnections("user", "old");
    expect(socket.close).not.toHaveBeenCalled();
    await hub.revokeWorkspaceConnections("user", "old", { force: true });
    expect(socket.close).toHaveBeenCalled();
  });

  it("notifies user sockets even without an open project", async () => {
    await start();
    const tab = fakeSocket();
    hub.addUserConnection("user", tab);
    await hub.revokeWorkspaceConnections("user", "old");
    expect(tab.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "WORKSPACE_ACCESS_REVOKED", workspaceId: "old" }),
    );
  });

  it("keeps instance admins connected without workspace membership", async () => {
    vi.useFakeTimers();
    await start();
    const socket = connect();
    reader.workspaceMemberIds.mockResolvedValue([]);
    reader.instanceAdminIds.mockResolvedValue(["user"]);
    hub.broadcastToProject("project", update);
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify(update));
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("stops broadcasts after membership removal even when fan-out was missed", async () => {
    vi.useFakeTimers();
    await start();
    const socket = connect();
    reader.workspaceMemberIds.mockResolvedValue([]);
    hub.broadcastToProject("project", update);
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1008, "Workspace access revoked");
  });

  it("closes only the removed member's workspace subscriptions", async () => {
    await start();
    const removed = connect();
    const unrelated = connect("other-project", "other-workspace");
    await hub.revokeWorkspaceConnections("user", "old");
    expect(removed.close).toHaveBeenCalledWith(1008, "Workspace access revoked");
    expect(unrelated.close).not.toHaveBeenCalled();
  });

  it("revokes remote subscriptions through the user Redis channel", async () => {
    await start(true);
    const socket = connect();
    redis.emit("kaneo:ws-user:*:broadcast", "kaneo:ws-user:user:broadcast", {
      userId: "user",
      origin: "remote-instance",
      message: { type: "WORKSPACE_ACCESS_REVOKED", workspaceId: "old" },
    });
    await vi.waitFor(() =>
      expect(socket.close).toHaveBeenCalledWith(1008, "Workspace access revoked"),
    );
  });
});

describe("project access revocation", () => {
  it("stops broadcasts to a member who lost project access even when the change was missed", async () => {
    vi.useFakeTimers();
    await start();
    const socket = connect();
    reader.usersWithProjectAccess.mockResolvedValue(new Set());
    hub.broadcastToProject("project", update);
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1008, "Project access revoked");
  });

  it("closes only the inaccessible project sockets and notifies every tab", async () => {
    await start();
    const revoked = connect();
    const kept = connect("kept-project");
    const elsewhere = connect("other-project", "other-workspace");
    const tab = fakeSocket();
    hub.addUserConnection("user", tab);
    reader.findInaccessibleProjectIds.mockResolvedValue(["project"]);
    await hub.projectAccessChanged("user", "old");
    await vi.waitFor(() =>
      expect(revoked.close).toHaveBeenCalledWith(1008, "Project access revoked"),
    );
    expect(reader.findInaccessibleProjectIds).toHaveBeenCalledWith("user", [
      "project",
      "kept-project",
    ]);
    expect(kept.close).not.toHaveBeenCalled();
    expect(elsewhere.close).not.toHaveBeenCalled();
    expect(tab.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "PROJECT_ACCESS_CHANGED", workspaceId: "old" }),
    );
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("keeps project sockets open when the access check fails", async () => {
    await start();
    const socket = connect();
    reader.findInaccessibleProjectIds.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await hub.projectAccessChanged("user", "old");
    await vi.waitFor(() =>
      expect(reader.findInaccessibleProjectIds).toHaveBeenCalled(),
    );
    await Promise.resolve();
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("fans the change out to other instances through the user Redis channel", async () => {
    await start(true);
    await hub.projectAccessChanged("user", "old");
    expect(redis.publish).toHaveBeenCalledWith(
      "kaneo:ws-user:user:broadcast",
      expect.any(String),
    );
    expect(redis.published()[0]).toMatchObject({
      userId: "user",
      message: { type: "PROJECT_ACCESS_CHANGED", workspaceId: "old" },
    });
  });

  it("revokes remote project sockets on a Redis project access change", async () => {
    await start(true);
    const socket = connect();
    reader.findInaccessibleProjectIds.mockResolvedValue(["project"]);
    redis.emit("kaneo:ws-user:*:broadcast", "kaneo:ws-user:user:broadcast", {
      userId: "user",
      origin: "remote-instance",
      message: { type: "PROJECT_ACCESS_CHANGED", workspaceId: "old" },
    });
    await vi.waitFor(() =>
      expect(socket.close).toHaveBeenCalledWith(1008, "Project access revoked"),
    );
  });

  it("does not let a pending project access change replace a workspace revocation", async () => {
    vi.useFakeTimers();
    await start(true);
    redis.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
    redis.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
    await hub.revokeWorkspaceConnections("user", "old", { force: true });
    await hub.projectAccessChanged("user", "old");
    await vi.advanceTimersByTimeAsync(1_000);
    const types = redis
      .published()
      .map((published) => (published.message as { type: string }).type);
    expect(
      types.filter((type) => type === "WORKSPACE_ACCESS_REVOKED"),
    ).toHaveLength(2);
    expect(
      types.filter((type) => type === "PROJECT_ACCESS_CHANGED"),
    ).toHaveLength(2);
  });

  it("rechecks local project sockets once per user after Redis reconnects", async () => {
    await start(true);
    const sync = vi.spyOn(hub, "syncWorkspaceAccess").mockResolvedValue();
    const revoked = connect();
    const kept = connect("kept-project");
    const elsewhere = connect("other-project", "other-workspace");
    const colleague = connect("project", "old", "colleague");
    const tab = fakeSocket();
    const colleagueTab = fakeSocket();
    hub.addUserConnection("user", tab);
    hub.addUserConnection("colleague", colleagueTab);
    reader.findInaccessibleProjectIds.mockImplementation(async (userId) =>
      userId === "user" ? ["project"] : [],
    );

    redis.ready();

    await vi.waitFor(() =>
      expect(revoked.close).toHaveBeenCalledWith(1008, "Project access revoked"),
    );
    expect(reader.findInaccessibleProjectIds).toHaveBeenCalledTimes(2);
    expect(reader.findInaccessibleProjectIds).toHaveBeenCalledWith("user", [
      "project",
      "kept-project",
      "other-project",
    ]);
    expect(reader.findInaccessibleProjectIds).toHaveBeenCalledWith(
      "colleague",
      ["project"],
    );
    expect(kept.close).not.toHaveBeenCalled();
    expect(elsewhere.close).not.toHaveBeenCalled();
    expect(colleague.close).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(tab.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "PROJECT_ACCESS_CHANGED", workspaceId: "old" }),
      ),
    );
    expect(tab.send).toHaveBeenCalledOnce();
    expect(tab.close).not.toHaveBeenCalled();
    expect(colleagueTab.send).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith("user", tab);
    expect(sync).toHaveBeenCalledWith("colleague", colleagueTab);
  });

  it("keeps project sockets open when the reconnect recheck fails", async () => {
    await start(true);
    const sync = vi.spyOn(hub, "syncWorkspaceAccess").mockResolvedValue();
    const socket = connect();
    const tab = fakeSocket();
    hub.addUserConnection("user", tab);
    reader.findInaccessibleProjectIds.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    redis.ready();

    await vi.waitFor(() =>
      expect(reader.findInaccessibleProjectIds).toHaveBeenCalledOnce(),
    );
    await vi.waitFor(() => expect(sync).toHaveBeenCalled());
    await Promise.resolve();
    expect(socket.close).not.toHaveBeenCalled();
    expect(tab.send).not.toHaveBeenCalled();
  });
});

it("coalesces authorization checks across a bulk broadcast burst", async () => {
  vi.useFakeTimers();
  await start();
  const socket = connect();
  for (let index = 0; index < 50; index++)
    hub.broadcastToProject("project", { ...update, taskId: `task-${index}` });
  await vi.advanceTimersByTimeAsync(100);
  expect(socket.send).toHaveBeenCalledTimes(50);
  expect(reader.workspaceMemberIds).toHaveBeenCalledTimes(1);
  expect(reader.usersWithProjectAccess).toHaveBeenCalledTimes(1);
});

it("does not reuse an older flush's membership snapshot for a later Redis broadcast", async () => {
  await start(true);
  const socket = connect();
  let finish!: (ids: string[]) => void;
  reader.workspaceMemberIds
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce([]);
  const receive = (authorizationBatch: string, taskId: string) =>
    redis.emit("kaneo:ws:*:broadcast", "kaneo:ws:project:broadcast", {
      projectId: "project",
      authorizationBatch,
      message: { ...update, taskId },
    });
  receive("before-removal", "old-event");
  receive("before-removal", "another-old-event");
  await vi.waitFor(() =>
    expect(reader.workspaceMemberIds).toHaveBeenCalledTimes(1),
  );
  receive("after-removal", "private-event");
  await vi.waitFor(() =>
    expect(reader.workspaceMemberIds).toHaveBeenCalledTimes(2),
  );
  finish(["user"]);
  await vi.waitFor(() => expect(socket.close).toHaveBeenCalled());
  expect(
    sentMessages(socket).some((message) => message.taskId === "private-event"),
  ).toBe(false);
});

it("still revokes local subscriptions when the post-removal role lookup fails", async () => {
  await start();
  const socket = connect();
  reader.userRole.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(
    hub.revokeWorkspaceConnections("user", "old"),
  ).resolves.toBeUndefined();
  expect(socket.close).toHaveBeenCalledWith(1008, "Workspace access revoked");
});

it("retries revocation delivery after Redis recovers without a project broadcast", async () => {
  vi.useFakeTimers();
  await start(true);
  redis.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
  await hub.revokeWorkspaceConnections("user", "old", { force: true });
  expect(redis.publish).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(redis.publish).toHaveBeenCalledTimes(2);
  expect(redis.published()[1]).toMatchObject({
    userId: "user",
    message: { type: "WORKSPACE_ACCESS_REVOKED", workspaceId: "old" },
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(redis.publish).toHaveBeenCalledTimes(2);
});

it("drops a queued membership revocation when access is restored before Redis recovery", async () => {
  vi.useFakeTimers();
  await start(true);
  redis.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
  await hub.revokeWorkspaceConnections("user", "old", { role: "user" });
  const reconnected = connect();
  reader.hasWorkspaceAccess.mockResolvedValue(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(redis.publish).toHaveBeenCalledTimes(1);
  expect(reconnected.close).not.toHaveBeenCalled();
});

it("retries a membership revocation while access remains absent", async () => {
  vi.useFakeTimers();
  await start(true);
  redis.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
  await hub.revokeWorkspaceConnections("user", "old", { role: "user" });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(redis.publish).toHaveBeenCalledTimes(2);
});

it("returns after local revocation while Redis PUBLISH remains queued", async () => {
  vi.useFakeTimers();
  await start(true);
  const socket = connect();
  let finish!: (value: number) => void;
  redis.publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await expect(
    hub.revokeWorkspaceConnections("user", "old", { force: true }),
  ).resolves.toBeUndefined();
  expect(socket.close).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(redis.publish).toHaveBeenCalledTimes(1);
  finish(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(redis.publish).toHaveBeenCalledTimes(1);
});

it("revokes every project subscription for a deleted user regardless of membership", async () => {
  const first = connect();
  const second = connect("other", "implicit-admin-workspace");
  await hub.revokeUserConnections("user");
  expect(first.close).toHaveBeenCalledWith(1008, "User access revoked");
  expect(second.close).toHaveBeenCalledWith(1008, "User access revoked");
});

it("revokes all remote subscriptions on a deleted-user Redis message", async () => {
  await start(true);
  const socket = connect("other", "implicit-admin-workspace");
  redis.emit("kaneo:ws-user:*:broadcast", "kaneo:ws-user:user:broadcast", {
    userId: "user",
    message: { type: "USER_ACCESS_REVOKED" },
  });
  await vi.waitFor(() =>
    expect(socket.close).toHaveBeenCalledWith(1008, "User access revoked"),
  );
});
