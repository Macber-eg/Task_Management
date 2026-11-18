import { createId } from "@paralleldrive/cuid2";
import type { EntityManager, EntityTarget, ObjectLiteral } from "typeorm";

/**
 * Inserts many rows in one statement, without reading them back. A property
 * left undefined takes the column's database default; a missing `id` gets a
 * cuid2. `conflict` is appended verbatim, e.g. `ON CONFLICT (...) DO NOTHING`.
 */
export async function insertRows<E extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<E>,
  rows: readonly Partial<E>[],
  conflict = "",
): Promise<void> {
  if (rows.length === 0) return;
  const metadata = manager.dataSource.getMetadata(target);
  const driver = manager.dataSource.driver;
  const hasId = metadata.primaryColumns.some(
    (column) => column.propertyName === "id",
  );
  const prepared = rows.map(
    (row): Record<string, unknown> =>
      hasId && row.id === undefined ? { ...row, id: createId() } : { ...row },
  );

  const columns = metadata.columns.filter((column) =>
    prepared.some((row) => row[column.propertyName] !== undefined),
  );
  const parameters: unknown[] = [];
  const values = prepared.map((row) => {
    const cells = columns.map((column) => {
      const value = row[column.propertyName];
      if (value === undefined) return "DEFAULT";
      parameters.push(driver.preparePersistentValue(value, column));
      return `$${parameters.length}`;
    });
    return `(${cells.join(", ")})`;
  });
  const names = columns.map((column) => driver.escape(column.databaseName));
  const suffix = conflict ? ` ${conflict}` : "";

  await manager.query(
    `INSERT INTO ${driver.escape(metadata.tableName)} (${names.join(", ")}) VALUES ${values.join(", ")}${suffix}`,
    parameters,
  );
}
