import type { DataSource } from "typeorm";
import { MIGRATIONS_TABLE } from "../../src/database/data-source-options";
import { assertTestDatabaseName } from "./test-database-url";

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Empties every table except the migration history. The catalog is asked
 * rather than the entity list so tables without an entity are cleared too.
 */
export async function resetTestDatabase(dataSource: DataSource): Promise<void> {
  const [current] = (await dataSource.query(
    "SELECT current_database() AS name",
  )) as { name: string }[];
  assertTestDatabaseName(current?.name ?? "");

  const tables = (await dataSource.query(
    `SELECT table_name AS name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name <> $1
     ORDER BY table_name`,
    [MIGRATIONS_TABLE],
  )) as { name: string }[];

  if (tables.length === 0) {
    throw new Error(
      "resetTestDatabase found no tables to truncate. Is the schema applied?",
    );
  }

  const names = tables.map((table) => quoteIdentifier(table.name)).join(", ");
  await dataSource.query(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
