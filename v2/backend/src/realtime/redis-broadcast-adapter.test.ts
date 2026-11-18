import { expect, it, vi } from "vitest";
import { fakeRedis } from "../../test/support/realtime-hub-fakes";
import { RedisBroadcastAdapter } from "./redis-broadcast-adapter";

it("retains the link-refresh flag when receiving a Redis project broadcast", async () => {
  const redis = fakeRedis();
  const adapter = new RedisBroadcastAdapter(redis.connections);
  const receive = vi.fn();
  await adapter.subscribe(receive);
  redis.emit("kaneo:ws:*:broadcast", "kaneo:ws:project:broadcast", {
    projectId: "project",
    message: {
      type: "PROJECT_UPDATED",
      projectId: "project",
      linksChanged: true,
      taskTitleChanged: true,
    },
  });
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.objectContaining({
        linksChanged: true,
        taskTitleChanged: true,
      }),
    }),
  );
  await adapter.shutdown();
});

it("uses the previous API's channels and drops malformed messages", async () => {
  const redis = fakeRedis();
  const adapter = new RedisBroadcastAdapter(redis.connections);
  const project = vi.fn();
  const user = vi.fn();
  await adapter.subscribe(project);
  await adapter.subscribeToUser(user);
  expect(redis.sub.psubscribe.mock.calls).toEqual([
    ["kaneo:ws:*:broadcast"],
    ["kaneo:ws-user:*:broadcast"],
  ]);

  await adapter.publish({
    projectId: "p",
    message: { type: "TASK_UPDATED", projectId: "p" },
  });
  await adapter.publishToUser({ userId: "u", message: { type: "X" } });
  expect(redis.publish.mock.calls.map(([channel]) => channel)).toEqual([
    "kaneo:ws:p:broadcast",
    "kaneo:ws-user:u:broadcast",
  ]);

  redis.emit("kaneo:ws:*:broadcast", "kaneo:ws:p:broadcast", "{");
  redis.emit("kaneo:ws:*:broadcast", "kaneo:ws:p:broadcast", { projectId: 1 });
  expect(project).not.toHaveBeenCalled();
  redis.emit("kaneo:ws-user:*:broadcast", "kaneo:ws-user:u:broadcast", {
    userId: "u",
    message: { type: "X", extra: 1 },
  });
  expect(user).toHaveBeenCalledWith({
    userId: "u",
    message: { type: "X", extra: 1 },
  });

  await adapter.shutdown();
  expect(redis.sub.punsubscribe).toHaveBeenCalledWith("kaneo:ws:*:broadcast");
  expect(redis.sub.punsubscribe).toHaveBeenCalledWith(
    "kaneo:ws-user:*:broadcast",
  );
  expect(redis.close).toHaveBeenCalled();
});
