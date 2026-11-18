import { Logger } from "@nestjs/common";
import type { ZodType } from "zod";
import type { RedisClients } from "../redis/redis-clients";
import type {
  BroadcastAdapter,
  BroadcastMessage,
  SessionRevocation,
  UserBroadcast,
} from "./broadcast-adapter";
import {
  broadcastMessageSchema,
  sessionRevocationSchema,
  userBroadcastSchema,
} from "./redis-broadcast-messages";

const CHANNEL_SUFFIX = ":broadcast";
const PROJECT_PREFIX = "kaneo:ws:";
const USER_PREFIX = "kaneo:ws-user:";
const SESSION_PREFIX = "kaneo:ws-session:";
const PROJECT_PATTERN = `${PROJECT_PREFIX}*${CHANNEL_SUFFIX}`;
const USER_PATTERN = `${USER_PREFIX}*${CHANNEL_SUFFIX}`;
const SESSION_PATTERN = `${SESSION_PREFIX}*${CHANNEL_SUFFIX}`;

type PatternListener = (pattern: string, channel: string, data: string) => void;

// A type-only import: this module must not load the client library itself.
export type RedisConnections = Pick<RedisClients, "pub" | "sub" | "close">;

/** Fans broadcasts out to every API instance through Redis pub/sub. */
export class RedisBroadcastAdapter implements BroadcastAdapter {
  private readonly logger = new Logger(RedisBroadcastAdapter.name);
  private readonly listeners: PatternListener[] = [];
  private recoveryHandler: (() => void) | null = null;
  private subscribed = false;
  private userSubscribed = false;
  private sessionSubscribed = false;

  constructor(private readonly redis: RedisConnections) {}

  async publish(msg: BroadcastMessage): Promise<void> {
    await this.redis
      .pub()
      .publish(channel(PROJECT_PREFIX, msg.projectId), JSON.stringify(msg));
  }

  async publishToUser(msg: UserBroadcast): Promise<void> {
    await this.redis
      .pub()
      .publish(channel(USER_PREFIX, msg.userId), JSON.stringify(msg));
  }

  async publishSessionRevocation(msg: SessionRevocation): Promise<void> {
    await this.redis
      .pub()
      .publish(channel(SESSION_PREFIX, msg.sessionId), JSON.stringify(msg));
  }

  async subscribe(
    handler: (msg: BroadcastMessage) => void | Promise<void>,
  ): Promise<void> {
    if (this.subscribed) return;
    this.subscribed = true;
    this.listen(PROJECT_PATTERN, broadcastMessageSchema, "project", (msg) =>
      handler(msg),
    );
    await this.redis.sub().psubscribe(PROJECT_PATTERN);
  }

  async subscribeToUser(
    handler: (msg: UserBroadcast) => void | Promise<void>,
    onRecovery?: () => Promise<void>,
  ): Promise<void> {
    if (this.userSubscribed) return;
    this.userSubscribed = true;
    this.listen(USER_PATTERN, userBroadcastSchema, "user", (msg, received) => {
      if (received !== channel(USER_PREFIX, msg.userId)) {
        this.logger.error("User broadcast channel and payload disagree");
        return;
      }
      return handler(msg);
    });
    if (onRecovery) {
      this.recoveryHandler = () => {
        if (!this.userSubscribed) return;
        // A browser socket can stay open while this subscriber misses messages.
        // Restore the subscription before taking an authoritative snapshot.
        void this.redis
          .sub()
          .psubscribe(USER_PATTERN)
          .then(async () => {
            if (this.userSubscribed) await onRecovery();
          })
          .catch((error: unknown) => {
            this.logger.error(
              "Failed to recover user broadcast subscription:",
              error,
            );
          });
      };
      this.redis.sub().on("ready", this.recoveryHandler);
    }
    await this.redis.sub().psubscribe(USER_PATTERN);
  }

  async subscribeToSessionRevocations(
    handler: (msg: SessionRevocation) => void | Promise<void>,
  ): Promise<void> {
    if (this.sessionSubscribed) return;
    this.sessionSubscribed = true;
    this.listen(SESSION_PATTERN, sessionRevocationSchema, "session", (msg) =>
      handler(msg),
    );
    await this.redis.sub().psubscribe(SESSION_PATTERN);
  }

  async shutdown(): Promise<void> {
    const sub = this.redis.sub();
    this.userSubscribed = false;
    if (this.recoveryHandler) {
      sub.off("ready", this.recoveryHandler);
      this.recoveryHandler = null;
    }
    for (const listener of this.listeners.splice(0)) {
      sub.off("pmessage", listener);
    }
    await sub.punsubscribe(PROJECT_PATTERN);
    await sub.punsubscribe(USER_PATTERN);
    await sub.punsubscribe(SESSION_PATTERN);
    this.subscribed = false;
    this.sessionSubscribed = false;
    await this.redis.close();
  }

  private listen<T>(
    pattern: string,
    schema: ZodType<T>,
    kind: string,
    handler: (msg: T, channel: string) => void | Promise<void>,
  ) {
    const listener: PatternListener = (received, channelName, data) => {
      if (received !== pattern) return;
      try {
        const parsed = schema.safeParse(JSON.parse(data));
        if (!parsed.success) {
          this.logger.error(`Invalid ${kind} broadcast message`, parsed.error);
          return;
        }
        void Promise.resolve(handler(parsed.data, channelName)).catch(
          (error: unknown) => {
            this.logger.error(`Failed to deliver ${kind} broadcast:`, error);
          },
        );
      } catch (error) {
        this.logger.error(`Failed to parse ${kind} broadcast message:`, error);
      }
    };
    this.listeners.push(listener);
    this.redis.sub().on("pmessage", listener);
  }
}

function channel(prefix: string, id: string) {
  return `${prefix}${id}${CHANNEL_SUFFIX}`;
}
