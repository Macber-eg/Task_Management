import type { DataSourceOptions } from "typeorm";
import { ALL_ENTITIES } from "./entities";
import { MIGRATIONS } from "./migrations";
import { configurePgUtc } from "./pg-utc";
import { resolveDatabaseConnectionString } from "./resolve-database-url";

export const MIGRATIONS_TABLE = "typeorm_migrations";

export function buildDataSourceOptions(): DataSourceOptions {
  configurePgUtc();

  return {
    type: "postgres",
    url: resolveDatabaseConnectionString(),
    entities: [...ALL_ENTITIES],
    migrations: [...MIGRATIONS],
    migrationsTableName: MIGRATIONS_TABLE,
    migrationsTransactionMode: "each",
    // The SQL migrations are the only schema authority: the database carries
    // triggers, partial indexes and composite foreign keys that entity
    // metadata cannot express, so TypeORM must never diff or sync it.
    synchronize: false,
    migrationsRun: false,
    installExtensions: false,
    useUTC: true,
    poolSize: 10,
    // A null or undefined that reaches a where clause is a bug, not a filter.
    invalidWhereValuesBehavior: { null: "throw", undefined: "throw" },
    extra: {
      // Fail fast when the database is slow to accept connections rather
      // than hanging every request.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      options: "-c timezone=UTC",
    },
  };
}
