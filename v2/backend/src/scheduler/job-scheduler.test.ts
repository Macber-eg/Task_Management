import { afterEach, describe, expect, it, vi } from "vitest";
import { JobScheduler } from "./job-scheduler";

const schedulers: JobScheduler[] = [];

function scheduler() {
  const created = new JobScheduler();
  schedulers.push(created);
  return created;
}

afterEach(() => {
  for (const created of schedulers.splice(0)) created.stop();
  vi.unstubAllEnvs();
});

describe("JobScheduler", () => {
  it("keeps every registered job and refuses a duplicate name", () => {
    const jobs = scheduler();
    jobs.register({ name: "a", cron: "* * * * *", run: async () => {} });
    jobs.register({ name: "b", cron: "17 * * * *", run: async () => {} });

    expect(jobs.jobs().map((job) => job.name)).toEqual(["a", "b"]);
    expect(() =>
      jobs.register({ name: "a", cron: "* * * * *", run: async () => {} }),
    ).toThrow('"a" is already registered');
  });

  it("does not start on bootstrap under NODE_ENV=test", () => {
    vi.stubEnv("NODE_ENV", "test");
    const jobs = scheduler();
    jobs.register({ name: "a", cron: "* * * * *", run: async () => {} });

    jobs.onApplicationBootstrap();

    expect(jobs.isRunning()).toBe(false);
  });

  it("starts on bootstrap outside tests and stops before shutdown", () => {
    vi.stubEnv("NODE_ENV", "production");
    const jobs = scheduler();
    jobs.register({ name: "a", cron: "* * * * *", run: async () => {} });

    jobs.onApplicationBootstrap();
    expect(jobs.isRunning()).toBe(true);

    jobs.beforeApplicationShutdown();
    expect(jobs.isRunning()).toBe(false);
  });

  it("lets a test start the schedules explicitly", () => {
    const jobs = scheduler();
    jobs.register({ name: "a", cron: "* * * * *", run: async () => {} });

    jobs.start();

    expect(jobs.isRunning()).toBe(true);
  });

  it("swallows a throwing run so the schedule survives", async () => {
    const jobs = scheduler();
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    jobs.register({ name: "a", cron: "* * * * *", run });

    await expect(jobs.runNow("a")).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledOnce();
  });

  it("fires a job on its cron schedule once started", async () => {
    vi.useFakeTimers();
    try {
      const jobs = scheduler();
      const run = vi.fn(async () => ({ degraded: false }));
      jobs.register({ name: "every-second", cron: "* * * * * *", run });
      jobs.start();

      await vi.advanceTimersByTimeAsync(2_100);

      expect(run).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
