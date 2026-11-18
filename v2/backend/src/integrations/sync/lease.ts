import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { SyncLeaseBusyError } from "./lease-busy-error";

const LEASE_MS = 15 * 60 * 1000;
const logger = new Logger("SyncLease");

/**
 * Runs `run` while holding the `job_lease` row `key`, shared by every API
 * instance. Waits up to `maxWaitMs` for another holder, then throws
 * `SyncLeaseBusyError`. Expired leases (a crashed holder) are taken over.
 */
export async function withSyncLease<T>(
  db: EntityManager,
  key: string,
  run: () => Promise<T>,
  { maxWaitMs = 5_000 }: { maxWaitMs?: number } = {},
): Promise<T> {
  const owner = randomUUID();
  const deadline = performance.now() + maxWaitMs;
  let retryDelay = 100;
  for (;;) {
    const claimed = (await db.query(
      `insert into job_lease (name, owner, expires_at)
       values ($1, $2, timezone('UTC', clock_timestamp()) + $3::int * interval '1 millisecond')
       on conflict (name) do update set owner = excluded.owner, expires_at = excluded.expires_at
       where job_lease.expires_at < timezone('UTC', clock_timestamp())
       returning name`,
      [key, owner, LEASE_MS],
    )) as unknown[];
    if (claimed.length) break;
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new SyncLeaseBusyError();
    await delay(Math.min(retryDelay, remaining));
    retryDelay = Math.min(retryDelay * 2, 1_000);
  }
  // Claims use short statements rather than reserving application connections
  // during provider requests. Slow exports block only their own task key.
  const renewal = setInterval(() => {
    void db
      .query(
        `update job_lease set expires_at = timezone('UTC', clock_timestamp()) + $3::int * interval '1 millisecond'
         where name = $1 and owner = $2`,
        [key, owner, LEASE_MS],
      )
      .catch(() => {
        logger.error(`Sync creation lease renewal failed (${key})`);
      });
  }, 60_000);
  renewal.unref();
  try {
    return await run();
  } finally {
    clearInterval(renewal);
    await db.query(`delete from job_lease where name = $1 and owner = $2`, [
      key,
      owner,
    ]);
  }
}
