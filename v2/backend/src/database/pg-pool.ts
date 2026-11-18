import type { Pool } from "pg";
import type { DataSource } from "typeorm";
import type { PostgresDriver } from "typeorm/driver/postgres/PostgresDriver";

/**
 * The node-postgres pool behind the data source, for the few callers that
 * need a dedicated connection outside a transaction (session-level advisory
 * locks). TypeORM types it as `any`.
 */
export function getPgPool(dataSource: DataSource): Pool {
  return (dataSource.driver as PostgresDriver).master as Pool;
}
