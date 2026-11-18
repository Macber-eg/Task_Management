import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
} from "@nestjs/common";

const DRAIN_TIMEOUT_MS = 10_000;

/**
 * Sign-in and password-reset mail is prepared and sent after the response:
 * neither the account lookup nor SMTP latency may reveal whether an address
 * has an account. Shutdown waits a bounded time for accepted deliveries.
 */
@Injectable()
export class BackgroundEmailDeliveries implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BackgroundEmailDeliveries.name);
  private readonly pending = new Set<Promise<void>>();

  /** `failureMessage` is all that is logged: provider errors can hold secrets. */
  queue(deliver: () => Promise<void>, failureMessage: string): void {
    const task: Promise<void> = Promise.resolve()
      .then(deliver)
      .catch(() => {
        this.logger.error(failureMessage);
      })
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** True when every queued delivery settled before the timeout. */
  async drain(timeoutMs = DRAIN_TIMEOUT_MS): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          while (this.pending.size > 0) await Promise.all(this.pending);
          return true;
        })(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (!(await this.drain())) {
      this.logger.warn("Timed out waiting for sign-in and recovery email delivery");
    }
  }
}
