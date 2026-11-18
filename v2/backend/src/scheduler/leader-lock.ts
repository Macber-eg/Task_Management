import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";

const INSTANCE_ID = randomUUID();

const DEFAULT_LEASE_MS = 15 * 60 * 1000;

/**
 * A lease in `job_lease` that lets one API replica run a job while the
 * others skip it. A lease outlives a crashed holder only until it expires.
 */
@Injectable()
export class JobLease {
  private readonly logger = new Logger(JobLease.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Runs `run` when this process takes the lease, else `whenHeldElsewhere`. */
  async withJobLease<T>(
    name: string,
    run: () => Promise<T>,
    whenHeldElsewhere: () => T,
    leaseMs: number = DEFAULT_LEASE_MS,
  ): Promise<T> {
    const expiresAt = new Date(Date.now() + leaseMs);

    const claimed = (await this.dataSource.query(
      `INSERT INTO job_lease ("name", "owner", "expires_at")
       VALUES ($1, $2, $3)
       ON CONFLICT ("name") DO UPDATE
         SET "owner" = EXCLUDED."owner", "expires_at" = EXCLUDED."expires_at"
         WHERE job_lease."expires_at" < now()
       RETURNING "name"`,
      [name, INSTANCE_ID, expiresAt],
    )) as unknown[];

    if (claimed.length === 0) {
      return whenHeldElsewhere();
    }

    try {
      return await run();
    } finally {
      await this.dataSource
        .query(`DELETE FROM job_lease WHERE "name" = $1 AND "owner" = $2`, [
          name,
          INSTANCE_ID,
        ])
        .catch((error: unknown) => {
          this.logger.error(`Failed to release the ${name} lease`, error);
        });
    }
  }
}
