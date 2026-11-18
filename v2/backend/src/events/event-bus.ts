import { EventEmitter } from "node:events";
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { eventContext } from "./event-context";

export type EventPayload<T = unknown> = {
  type: string;
  data: T;
  timestamp: string;
};

type Listener = (payload: EventPayload) => Promise<void>;

/**
 * In-process publish/subscribe for domain events (activity log,
 * notifications, integrations, WebSocket broadcasts). Events are not
 * persisted and never leave the process; fan-out across instances is the
 * realtime layer's job.
 */
@Injectable()
export class EventBus implements OnApplicationShutdown {
  private readonly logger = new Logger(EventBus.name);
  private readonly emitter = new EventEmitter().setMaxListeners(100);

  async publish(
    eventType: string,
    data: unknown,
    options?: { waitForHandlers?: boolean },
  ): Promise<void> {
    const enhanced =
      typeof data === "object" && data !== null
        ? { ...data, initiatorId: eventContext.getStore()?.initiatorId }
        : data;

    const payload: EventPayload = {
      type: eventType,
      data: enhanced,
      timestamp: new Date().toISOString(),
    };

    try {
      if (options?.waitForHandlers) {
        // EventEmitter.emit discards promises. Bounded producers must await
        // each subscriber before starting their next item.
        for (const listener of this.emitter.listeners(eventType)) {
          await (listener as Listener)(payload);
        }
      } else {
        this.emitter.emit(eventType, payload);
      }
    } catch (error) {
      this.logger.error("Failed to publish event", error);
      throw error;
    }
  }

  subscribe<T>(eventType: string, handler: (data: T) => Promise<void>): void {
    this.emitter.on(eventType, async (payload: EventPayload<T>) => {
      try {
        await handler(payload.data);
      } catch (error) {
        this.logger.error(`Error processing event ${eventType}`, error);
      }
    });
  }

  onApplicationShutdown(): void {
    this.emitter.removeAllListeners();
  }
}
