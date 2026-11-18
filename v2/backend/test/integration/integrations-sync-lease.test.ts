import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { JobLeaseEntity } from "../../src/database/entities/job-lease.entity";
import { withSyncLease } from "../../src/integrations/sync/lease";
import { SyncLeaseBusyError } from "../../src/integrations/sync/lease-busy-error";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/sync-lease.test.ts.
let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => resetTestDatabase(app.dataSource));

it("bounds contention with backoff, preserves another owner's lease, and allows a later retry", async () => {
  const key = "sync-create:crashed-holder";
  await insertRow(app.db, JobLeaseEntity, {
    name: key,
    owner: "other-instance",
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  const run = vi.fn(async () => "complete");
  const queries = vi.spyOn(app.db, "query");
  const started = performance.now();
  await expect(
    withSyncLease(app.db, key, run, { maxWaitMs: 120 }),
  ).rejects.toBeInstanceOf(SyncLeaseBusyError);
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(run).not.toHaveBeenCalled();
  expect(queries.mock.calls.length).toBeLessThanOrEqual(4);
  expect((await app.db.find(JobLeaseEntity))[0]?.owner).toBe("other-instance");
  await app.db.delete(JobLeaseEntity, { name: key });
  await expect(
    withSyncLease(app.db, key, run, { maxWaitMs: 120 }),
  ).resolves.toBe("complete");
  expect(run).toHaveBeenCalledOnce();
  expect(await app.db.find(JobLeaseEntity)).toHaveLength(0);
});

it("takes over a lease whose holder expired", async () => {
  const key = "sync-create:expired-holder";
  await insertRow(app.db, JobLeaseEntity, {
    name: key,
    owner: "crashed-instance",
    expiresAt: new Date(Date.now() - 60_000),
  });
  await expect(withSyncLease(app.db, key, async () => "taken")).resolves.toBe(
    "taken",
  );
  expect(await app.db.find(JobLeaseEntity)).toHaveLength(0);
});
