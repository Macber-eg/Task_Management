import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { getPgPool } from "../../../database/pg-pool";

export const MAX_GITHUB_IMPORTS_IN_FLIGHT = 2;
const LOCK_NAMESPACE = 773623;

function busy() {
  return new HTTPException(429, {
    res: new Response("GitHub import is busy; retry this request", {
      status: 429,
      headers: { "Retry-After": "1" },
    }),
  });
}

/**
 * Bounds GitHub imports: at most two in flight across all instances (one
 * advisory-lock slot each) and one per project. Session locks span awaited
 * provider calls without holding a SQL transaction.
 */
@Injectable()
export class GitHubImportLock {
  private active = 0;

  constructor(private readonly dataSource: DataSource) {}

  async run<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_GITHUB_IMPORTS_IN_FLIGHT) throw busy();
    this.active++;
    let client: PoolClient | undefined;
    let slot: number | undefined;
    let importLocked = false;
    let releaseError: Error | undefined;
    try {
      client = await getPgPool(this.dataSource).connect();
      for (
        let candidate = 0;
        candidate < MAX_GITHUB_IMPORTS_IN_FLIGHT;
        candidate++
      ) {
        const { rows } = await client.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
          [LOCK_NAMESPACE, candidate],
        );
        if (rows[0]?.acquired) {
          slot = candidate;
          break;
        }
      }
      if (slot === undefined) throw busy();
      const { rows } = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [`github-import:${id}`],
      );
      importLocked = rows[0]?.acquired === true;
      if (!importLocked) throw busy();
      return await run();
    } finally {
      if (client) {
        try {
          if (importLocked)
            await client.query(
              "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
              [`github-import:${id}`],
            );
          if (slot !== undefined)
            await client.query(
              "SELECT pg_advisory_unlock($1::int, $2::int)",
              [LOCK_NAMESPACE, slot],
            );
        } catch (error) {
          // Destroy a connection whose lock release was not confirmed.
          releaseError =
            error instanceof Error
              ? error
              : new Error("Import lock release failed");
        }
        client.release(releaseError);
      }
      this.active--;
    }
  }
}
