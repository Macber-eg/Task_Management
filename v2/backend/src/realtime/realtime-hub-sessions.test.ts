import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createHub,
  createRedisHub,
  type FakeReader,
  type FakeRedis,
  fakeReader,
  fakeRedis,
  fakeSocket,
} from "../../test/support/realtime-hub-fakes";
import type { RealtimeHub } from "./realtime-hub";

let reader: FakeReader;
let redis: FakeRedis;
let hub: RealtimeHub;

function open(sessionId: string | null, userId = "user") {
  const board = fakeSocket();
  const tab = fakeSocket();
  hub.addProjectConnection("project", board, {
    userId,
    initiatorId: userId,
    workspaceId: "old",
    sessionId,
  });
  hub.addUserConnection(userId, tab, sessionId);
  return { board, tab };
}

beforeEach(async () => {
  reader = fakeReader();
  redis = fakeRedis();
  hub = createRedisHub(reader, redis);
  await hub.start();
});

afterEach(async () => {
  await hub.stop();
});

it("closes only the sockets opened by the revoked session", async () => {
  const revoked = open("session-a");
  const sameUserOtherLogin = open("session-b");
  const apiKey = open(null);

  await hub.revokeSessionConnections("session-a");

  expect(revoked.board.close).toHaveBeenCalledWith(1008, "Session revoked");
  expect(revoked.tab.close).toHaveBeenCalledWith(1008, "Session revoked");
  for (const socket of [
    sameUserOtherLogin.board,
    sameUserOtherLogin.tab,
    apiKey.board,
    apiKey.tab,
  ])
    expect(socket.close).not.toHaveBeenCalled();
});

it("tells other instances, which close their sockets for the session", async () => {
  await hub.revokeSessionConnections("session-a");
  expect(redis.published()).toEqual([
    expect.objectContaining({
      channel: "kaneo:ws-session:session-a:broadcast",
      sessionId: "session-a",
    }),
  ]);

  const remote = open("session-b");
  redis.emit(
    "kaneo:ws-session:*:broadcast",
    "kaneo:ws-session:session-b:broadcast",
    { sessionId: "session-b", origin: "other-instance" },
  );
  expect(remote.tab.close).toHaveBeenCalledWith(1008, "Session revoked");
  expect(remote.board.close).toHaveBeenCalledWith(1008, "Session revoked");
});

it("does not wait for Redis to sign a session out", async () => {
  redis.publish.mockReturnValue(new Promise(() => {}));
  const local = open("session-a");
  await hub.revokeSessionConnections("session-a");
  expect(local.tab.close).toHaveBeenCalled();
});

it("closes sockets on a single instance without Redis", async () => {
  await hub.stop();
  hub = createHub(reader);
  await hub.start();
  const local = open("session-a");
  await hub.revokeSessionConnections("session-a");
  expect(local.board.close).toHaveBeenCalledWith(1008, "Session revoked");
});
