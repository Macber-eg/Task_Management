import { Logger } from "@nestjs/common";
import Redis, { type Cluster } from "ioredis";
import { resolveRedisMode } from "./resolve-redis-mode";

export type RedisClient = Redis | Cluster;

function createRedisClient(): RedisClient {
  const config = resolveRedisMode();
  switch (config.mode) {
    case "cluster":
      return new Redis.Cluster(config.nodes, {
        redisOptions: { password: config.password },
        clusterRetryStrategy: (times) => Math.min(times * 100, 3000),
      });
    case "sentinel":
      return new Redis({
        sentinels: config.sentinels,
        name: config.name,
        password: config.password,
        sentinelPassword: config.sentinelPassword,
        enableTLSForSentinelMode: config.enableTLSForSentinelMode,
      });
    case "standalone":
      return new Redis(config.url);
  }
}

/**
 * The publishing and subscribing connections, opened on first use. A
 * subscribed connection cannot publish, hence two. Only loaded when Redis is
 * configured, so a single instance never imports the client library.
 */
export class RedisClients {
  private readonly logger = new Logger("Redis");
  private publisher: RedisClient | null = null;
  private subscriber: RedisClient | null = null;

  pub(): RedisClient {
    this.publisher ??= this.open("pub");
    return this.publisher;
  }

  sub(): RedisClient {
    this.subscriber ??= this.open("sub");
    return this.subscriber;
  }

  async close(): Promise<void> {
    if (this.publisher) {
      await this.publisher.quit();
      this.publisher = null;
    }
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }

  private open(role: string): RedisClient {
    const client = createRedisClient();
    client.on("error", (error: Error) =>
      this.logger.error(`Redis ${role} client error:`, error),
    );
    return client;
  }
}
