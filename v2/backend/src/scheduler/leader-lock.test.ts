import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import { JobLease } from "./leader-lock";

// Stands in for PostgreSQL's ON CONFLICT ... WHERE expires_at < now(): a
// claim wins when the name is free or its lease has expired.
function leaseTable() {
  const leases = new Map<string, { owner: string; expiresAt: Date }>();
  const query = vi.fn(async (sql: string, parameters: unknown[]) => {
    const [name, owner, expiresAt] = parameters as [string, string, Date];
    if (sql.startsWith("INSERT")) {
      const held = leases.get(name);
      if (held && held.expiresAt.getTime() >= Date.now()) return [];
      leases.set(name, { owner, expiresAt });
      return [{ name }];
    }
    if (leases.get(name)?.owner === owner) leases.delete(name);
    return [];
  });
  return { leases, dataSource: { query } as unknown as DataSource, query };
}

describe("JobLease", () => {
  it("runs the job and releases the lease", async () => {
    const { leases, dataSource } = leaseTable();

    const result = await new JobLease(dataSource).withJobLease(
      "job",
      async () => "ran",
      () => "skipped",
    );

    expect(result).toBe("ran");
    expect(leases.size).toBe(0);
  });

  it("skips while another replica holds a live lease", async () => {
    const { leases, dataSource } = leaseTable();
    leases.set("job", {
      owner: "other-replica",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const run = vi.fn(async () => "ran");

    const result = await new JobLease(dataSource).withJobLease(
      "job",
      run,
      () => "skipped",
    );

    expect(result).toBe("skipped");
    expect(run).not.toHaveBeenCalled();
    expect(leases.get("job")?.owner).toBe("other-replica");
  });

  it("releases the lease when the job throws", async () => {
    const { leases, dataSource } = leaseTable();

    await expect(
      new JobLease(dataSource).withJobLease(
        "job",
        async () => {
          throw new Error("job blew up");
        },
        () => "skipped",
      ),
    ).rejects.toThrow("job blew up");

    expect(leases.size).toBe(0);
  });

  it("asks for a lease that expires after the given duration", async () => {
    const { dataSource, query } = leaseTable();
    const before = Date.now();

    await new JobLease(dataSource).withJobLease(
      "job",
      async () => undefined,
      () => undefined,
      5_000,
    );

    const expiresAt = query.mock.calls[0]?.[1][2] as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("returns the job's result even when releasing fails", async () => {
    const { dataSource, query } = leaseTable();
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("INSERT")) return [{ name: "job" }];
      throw new Error("connection lost");
    });

    await expect(
      new JobLease(dataSource).withJobLease(
        "job",
        async () => "ran",
        () => "skipped",
      ),
    ).resolves.toBe("ran");
  });
});
