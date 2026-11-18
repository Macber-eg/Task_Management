import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JobLeaseEntity } from "../../src/database/entities/job-lease.entity";
import { JobScheduler } from "../../src/scheduler/job-scheduler";
import { JobLease } from "../../src/scheduler/leader-lock";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const LEASE = "integration-test-lease";

let app: TestApp;
let lease: JobLease;

beforeAll(async () => {
  app = await createTestApp();
  lease = app.get(JobLease);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
});

function readLease(name = LEASE) {
  return app.db.findOneBy(JobLeaseEntity, { name });
}

function heldLease() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = false;
  const holder = lease.withJobLease(
    LEASE,
    async () => {
      holding = true;
      await held;
      return "ran";
    },
    () => "skipped",
  );
  return { holder, release, isHolding: () => holding };
}

describe("the application's scheduled jobs", () => {
  it("registers every job with its schedule and leaves them stopped under test", () => {
    const scheduler = app.get(JobScheduler);

    expect(
      Object.fromEntries(
        scheduler.jobs().map((job) => [job.name, [job.cron, job.protect ?? false]]),
      ),
    ).toMatchObject({
      "storage-cleanup": ["*/5 * * * *", true],
      "draft-upload-cleanup": ["31 * * * *", true],
      "due-date-reminders": ["*/5 * * * *", false],
      "seat-reconciliation": ["17 * * * *", false],
      "trial-reminders": ["23 * * * *", false],
    });
    expect(scheduler.isRunning()).toBe(false);
  });

  it("runs a registered job on demand", async () => {
    await expect(
      app.get(JobScheduler).runNow("due-date-reminders"),
    ).resolves.toBeUndefined();
  });
});

describe("JobLease against PostgreSQL", () => {
  it("lets a second caller skip while the first still holds the lease", async () => {
    const first = heldLease();
    try {
      await vi.waitFor(() => expect(first.isHolding()).toBe(true));
      const secondRun = vi.fn(async () => "ran");

      expect(await lease.withJobLease(LEASE, secondRun, () => "skipped")).toBe(
        "skipped",
      );
      expect(secondRun).not.toHaveBeenCalled();
    } finally {
      first.release();
      await expect(first.holder).resolves.toBe("ran");
    }
  });

  it("releases the lease so a later run can take it", async () => {
    expect(
      await lease.withJobLease(LEASE, async () => "ran", () => "skipped"),
    ).toBe("ran");
    expect(
      await lease.withJobLease(LEASE, async () => "ran", () => "skipped"),
    ).toBe("ran");
    expect(await readLease()).toBeNull();
  });

  it("releases the lease when the job throws", async () => {
    await expect(
      lease.withJobLease(
        LEASE,
        async () => {
          throw new Error("job blew up");
        },
        () => "skipped",
      ),
    ).rejects.toThrow("job blew up");

    expect(await readLease()).toBeNull();
    expect(
      await lease.withJobLease(LEASE, async () => "ran", () => "skipped"),
    ).toBe("ran");
  });

  it("takes over a lease left behind by a crashed replica", async () => {
    await app.dataSource.query(
      `INSERT INTO job_lease ("name", "owner", "expires_at")
       VALUES ($1, 'dead-replica', now() - interval '1 minute')`,
      [LEASE],
    );

    expect(
      await lease.withJobLease(LEASE, async () => "ran", () => "skipped"),
    ).toBe("ran");
  });

  it("does not take over a lease that is still live", async () => {
    await app.dataSource.query(
      `INSERT INTO job_lease ("name", "owner", "expires_at")
       VALUES ($1, 'other-replica', now() + interval '10 minutes')`,
      [LEASE],
    );

    expect(
      await lease.withJobLease(LEASE, async () => "ran", () => "skipped"),
    ).toBe("skipped");
    expect((await readLease())?.owner).toBe("other-replica");
  });

  it("does not block a different lease name", async () => {
    const holder = heldLease();
    try {
      await vi.waitFor(() => expect(holder.isHolding()).toBe(true));

      expect(
        await lease.withJobLease(
          `${LEASE}-other`,
          async () => "ran",
          () => "skipped",
        ),
      ).toBe("ran");
    } finally {
      holder.release();
      await holder.holder;
    }
  });
});
