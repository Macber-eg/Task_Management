import { vi } from "vitest";
import type { BroadcastAdapter } from "../../src/realtime/broadcast-adapter";
import type { BroadcastAdapterFactory } from "../../src/realtime/broadcast-adapter-factory";
import { InMemoryBroadcastAdapter } from "../../src/realtime/in-memory-broadcast-adapter";
import type { RealtimeAccessReader } from "../../src/realtime/realtime-access-reader";
import {
  RedisBroadcastAdapter,
  type RedisConnections,
} from "../../src/realtime/redis-broadcast-adapter";
import { RealtimeHub } from "../../src/realtime/realtime-hub";

/**
 * Database answers for the realtime layer. By default "user" is the only
 * member of workspace "old", which owns every project, and sees all of them.
 */
export function fakeReader() {
  return {
    projectWorkspaceId: vi.fn<RealtimeAccessReader["projectWorkspaceId"]>(
      async () => "old",
    ),
    workspaceMemberIds: vi.fn<RealtimeAccessReader["workspaceMemberIds"]>(
      async () => ["user"],
    ),
    instanceAdminIds: vi.fn<RealtimeAccessReader["instanceAdminIds"]>(
      async () => [],
    ),
    usersWithProjectAccess: vi.fn<
      RealtimeAccessReader["usersWithProjectAccess"]
    >(async (userIds) => new Set(userIds)),
    userRole: vi.fn<RealtimeAccessReader["userRole"]>(async () => ({
      role: "user",
    })),
    hasWorkspaceAccess: vi.fn<RealtimeAccessReader["hasWorkspaceAccess"]>(
      async () => false,
    ),
    accessibleWorkspaceIds: vi.fn<
      RealtimeAccessReader["accessibleWorkspaceIds"]
    >(async () => ["old"]),
    findInaccessibleProjectIds: vi.fn<
      RealtimeAccessReader["findInaccessibleProjectIds"]
    >(async () => []),
    workspaceProjectIds: vi.fn<RealtimeAccessReader["workspaceProjectIds"]>(
      async () => [],
    ),
    subtaskParentProjects: vi.fn<
      RealtimeAccessReader["subtaskParentProjects"]
    >(async () => []),
    relationSourceProjects: vi.fn<
      RealtimeAccessReader["relationSourceProjects"]
    >(async () => []),
  };
}

export type FakeReader = ReturnType<typeof fakeReader>;

type PatternListener = (pattern: string, channel: string, data: string) => void;

/** A Redis stand-in that records publishes and lets tests deliver messages. */
export function fakeRedis() {
  const publish = vi.fn(async (_channel: string, _message: string) => 1);
  const sub = {
    on: vi.fn(),
    off: vi.fn(),
    psubscribe: vi.fn(async (_pattern: string) => undefined),
    punsubscribe: vi.fn(async (_pattern: string) => undefined),
  };
  const close = vi.fn(async () => {});
  const connections = {
    pub: () => ({ publish }),
    sub: () => sub,
    close,
  } as unknown as RedisConnections;

  function listeners(event: string) {
    return sub.on.mock.calls
      .filter(([name]) => name === event)
      .map(([, listener]) => listener as PatternListener)
      .filter((listener) =>
        sub.off.mock.calls.every(([, removed]) => removed !== listener),
      );
  }

  return {
    publish,
    sub,
    close,
    connections,
    /** Delivers a message as Redis would on a pattern subscription. */
    emit(pattern: string, channel: string, payload: unknown) {
      const data =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      for (const listener of listeners("pmessage"))
        listener(pattern, channel, data);
    },
    /** Simulates the subscriber reconnecting. */
    ready() {
      for (const listener of listeners("ready"))
        (listener as unknown as () => void)();
    },
    /** What was published, parsed. */
    published(): Array<Record<string, unknown> & { channel: string }> {
      return publish.mock.calls.map(([channel, message]) => ({
        ...(JSON.parse(message) as Record<string, unknown>),
        channel,
      }));
    },
  };
}

export type FakeRedis = ReturnType<typeof fakeRedis>;

export function createHub(
  reader: FakeReader,
  adapter: BroadcastAdapter = new InMemoryBroadcastAdapter(),
) {
  const factory = { create: async () => adapter };
  return new RealtimeHub(
    reader as unknown as RealtimeAccessReader,
    factory as unknown as BroadcastAdapterFactory,
  );
}

export function createRedisHub(reader: FakeReader, redis: FakeRedis) {
  return createHub(reader, new RedisBroadcastAdapter(redis.connections));
}

export function fakeSocket() {
  return { send: vi.fn<(data: string) => void>(), close: vi.fn() };
}

export function sentMessages(socket: ReturnType<typeof fakeSocket>) {
  return socket.send.mock.calls.map(
    ([data]) => JSON.parse(data) as Record<string, unknown>,
  );
}
