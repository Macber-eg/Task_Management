import { Injectable } from "@nestjs/common";
import { isRedisConfigured } from "../redis/is-redis-configured";
import type { BroadcastAdapter } from "./broadcast-adapter";
import { InMemoryBroadcastAdapter } from "./in-memory-broadcast-adapter";

/**
 * Redis when it is configured, otherwise in-process delivery. The Redis
 * modules are imported only in the first case, so a single instance never
 * loads the client library or opens a connection.
 */
@Injectable()
export class BroadcastAdapterFactory {
  async create(): Promise<BroadcastAdapter> {
    if (!isRedisConfigured()) return new InMemoryBroadcastAdapter();
    const [{ RedisBroadcastAdapter }, { RedisClients }] = await Promise.all([
      import("./redis-broadcast-adapter.js"),
      import("../redis/redis-clients.js"),
    ]);
    return new RedisBroadcastAdapter(new RedisClients());
  }
}
