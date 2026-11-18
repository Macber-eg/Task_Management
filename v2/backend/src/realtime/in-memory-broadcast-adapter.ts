import type {
  BroadcastAdapter,
  BroadcastMessage,
  SessionRevocation,
  UserBroadcast,
} from "./broadcast-adapter";

/** A single instance: every broadcast is delivered in this process. */
export class InMemoryBroadcastAdapter implements BroadcastAdapter {
  private handler?: (msg: BroadcastMessage) => void | Promise<void>;
  private userHandler?: (msg: UserBroadcast) => void | Promise<void>;
  private sessionHandler?: (msg: SessionRevocation) => void | Promise<void>;

  async publish(msg: BroadcastMessage): Promise<void> {
    await this.handler?.(msg);
  }

  async publishToUser(msg: UserBroadcast): Promise<void> {
    await this.userHandler?.(msg);
  }

  async publishSessionRevocation(msg: SessionRevocation): Promise<void> {
    await this.sessionHandler?.(msg);
  }

  async subscribe(
    handler: (msg: BroadcastMessage) => void | Promise<void>,
  ): Promise<void> {
    this.handler = handler;
  }

  async subscribeToUser(
    handler: (msg: UserBroadcast) => void | Promise<void>,
  ): Promise<void> {
    this.userHandler = handler;
  }

  async subscribeToSessionRevocations(
    handler: (msg: SessionRevocation) => void | Promise<void>,
  ): Promise<void> {
    this.sessionHandler = handler;
  }

  async shutdown(): Promise<void> {
    this.handler = undefined;
    this.userHandler = undefined;
    this.sessionHandler = undefined;
  }
}
