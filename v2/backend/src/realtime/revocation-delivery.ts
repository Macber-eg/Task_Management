import type { BroadcastAdapter, UserBroadcast } from "./broadcast-adapter";

type Pending = {
  message: UserBroadcast;
  shouldRetry?: () => Promise<boolean>;
  inFlight?: boolean;
};

/**
 * Publishes access revocations to other instances, retrying with backoff
 * (1s doubling to 30s) until Redis accepts them. A newer revocation of the
 * same kind for the same user and workspace replaces a pending one.
 */
export function createRevocationDelivery(
  adapter: Pick<BroadcastAdapter, "publishToUser">,
) {
  const pending = new Map<string, Pending>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let delay = 1_000;

  const attempt = async (key: string, entry: Pending, retry = false) => {
    if (entry.inFlight) return;
    entry.inFlight = true;
    try {
      if (!retry || !entry.shouldRetry || (await entry.shouldRetry())) {
        if (stopped || pending.get(key) !== entry) return;
        await adapter.publishToUser(entry.message);
      }
      if (pending.get(key) === entry) pending.delete(key);
    } catch {
      // Membership is already removed. Keep the signal until Redis recovers.
    } finally {
      entry.inFlight = false;
    }
  };
  const schedule = () => {
    if (stopped || timer || !pending.size) return;
    timer = setTimeout(async () => {
      timer = undefined;
      await Promise.all(
        [...pending].map(([key, entry]) => attempt(key, entry, true)),
      );
      delay = pending.size ? Math.min(delay * 2, 30_000) : 1_000;
      schedule();
    }, delay);
    timer.unref();
  };
  return {
    async send(message: UserBroadcast, shouldRetry?: () => Promise<boolean>) {
      if (stopped) return;
      const key = JSON.stringify([
        message.userId,
        message.message.workspaceId,
        message.message.type,
      ]);
      const entry: Pending = { message, shouldRetry };
      pending.set(key, entry);
      // Redis can queue PUBLISH through a long outage. Local revocation has
      // already happened; the committed request must not await recovery.
      void attempt(key, entry).then(schedule);
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}

export type RevocationDelivery = ReturnType<typeof createRevocationDelivery>;
