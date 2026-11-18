import { createId } from "@paralleldrive/cuid2";
import type {
  EntityManager,
  EntityMetadata,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
} from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/**
 * Write helpers that return the affected rows as entity-shaped objects.
 *
 * TypeORM's `.returning("*")` hands back raw rows keyed by database column
 * (`created_at`), and a targeted `ON CONFLICT (...) DO NOTHING` has no query
 * builder form. These helpers cover both, and apply the two application-side
 * defaults the schema relies on: a cuid2 `id`, and `updatedAt` on write.
 */

type Row = Record<string, unknown>;

type ConflictOptions<E> = {
  /** Entity properties forming the unique index or constraint. */
  target: (keyof E & string)[];
  /** Predicate of a partial unique index, e.g. `task_id IS NULL`. */
  where?: string;
  /** Properties to overwrite on conflict. Omit for DO NOTHING. */
  update?: (keyof E & string)[];
};

export type InsertOptions<E> = { onConflict?: ConflictOptions<E> };

function hydrate<E>(
  manager: EntityManager,
  metadata: EntityMetadata,
  raw: Row,
): E {
  const driver = manager.dataSource.driver;
  const entity: Row = {};
  for (const column of metadata.columns) {
    if (!(column.databaseName in raw)) continue;
    entity[column.propertyName] = driver.prepareHydratedValue(
      raw[column.databaseName],
      column,
    );
  }
  return entity as E;
}

function columnOf(metadata: EntityMetadata, property: string) {
  const column = metadata.findColumnWithPropertyName(property);
  if (!column) {
    throw new Error(`${metadata.name} has no column for "${property}"`);
  }
  return column;
}

function withInsertDefaults(metadata: EntityMetadata, values: Row): Row {
  const prepared: Row = { ...values };

  const [primary] = metadata.primaryColumns;
  if (
    metadata.primaryColumns.length === 1 &&
    primary?.propertyName === "id" &&
    prepared.id === undefined
  ) {
    prepared.id = createId();
  }

  // Tables whose `updated_at` has no database default get their first value
  // from the application, as the previous backend did.
  const updated = metadata.updateDateColumn;
  if (
    updated &&
    prepared[updated.propertyName] === undefined &&
    APP_MAINTAINED_UPDATED_AT.has(metadata.tableName)
  ) {
    prepared[updated.propertyName] = new Date();
  }
  return prepared;
}

/** Tables whose `updated_at` has no database default. */
const APP_MAINTAINED_UPDATED_AT = new Set([
  "session",
  "account",
  "apikey",
  "team",
]);

function conflictClause<E>(
  manager: EntityManager,
  metadata: EntityMetadata,
  conflict: ConflictOptions<E>,
): string {
  const escape = (name: string) => manager.dataSource.driver.escape(name);
  const target = conflict.target
    .map((property) => escape(columnOf(metadata, property).databaseName))
    .join(", ");
  const predicate = conflict.where ? ` WHERE ${conflict.where}` : "";
  if (!conflict.update?.length) {
    return ` ON CONFLICT (${target})${predicate} DO NOTHING`;
  }
  const assignments = conflict.update
    .map((property) => {
      const name = escape(columnOf(metadata, property).databaseName);
      return `${name} = EXCLUDED.${name}`;
    })
    .join(", ");
  return ` ON CONFLICT (${target})${predicate} DO UPDATE SET ${assignments}`;
}

/**
 * Inserts one row and returns it, or `undefined` when an `onConflict` target
 * matched and nothing was written.
 */
export async function insertReturning<E extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<E>,
  values: Partial<E>,
  options: InsertOptions<E> = {},
): Promise<E | undefined> {
  const metadata = manager.dataSource.getMetadata(target);
  const driver = manager.dataSource.driver;
  const prepared = withInsertDefaults(metadata, values as Row);

  const columns = metadata.columns.filter(
    (column) => prepared[column.propertyName] !== undefined,
  );
  const names = columns.map((column) => driver.escape(column.databaseName));
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const parameters = columns.map((column) =>
    driver.preparePersistentValue(prepared[column.propertyName], column),
  );

  const insert = columns.length
    ? `(${names.join(", ")}) VALUES (${placeholders.join(", ")})`
    : "DEFAULT VALUES";
  const conflict = options.onConflict
    ? conflictClause(manager, metadata, options.onConflict)
    : "";

  const rows = (await manager.query(
    `INSERT INTO ${driver.escape(metadata.tableName)} ${insert}${conflict} RETURNING *`,
    parameters,
  )) as Row[];

  const [row] = rows;
  return row ? hydrate<E>(manager, metadata, row) : undefined;
}

/** Updates the matching rows and returns them as they are after the write. */
export async function updateReturning<E extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<E>,
  set: QueryDeepPartialEntity<E>,
  where: FindOptionsWhere<E>,
): Promise<E[]> {
  const metadata = manager.dataSource.getMetadata(target);
  const values: Row = { ...(set as Row) };

  // The previous backend stamped `updatedAt` from the application clock on
  // every write; without this TypeORM would use the database's
  // CURRENT_TIMESTAMP, which has microsecond precision.
  const updated = metadata.updateDateColumn;
  if (updated && values[updated.propertyName] === undefined) {
    values[updated.propertyName] = new Date();
  }

  const result = await manager
    .createQueryBuilder()
    .update(target)
    .set(values as QueryDeepPartialEntity<E>)
    .where(where)
    .returning("*")
    .execute();

  return (result.raw as Row[]).map((row) => hydrate<E>(manager, metadata, row));
}

/** Deletes the matching rows and returns what was removed. */
export async function deleteReturning<E extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<E>,
  where: FindOptionsWhere<E>,
): Promise<E[]> {
  const metadata = manager.dataSource.getMetadata(target);
  const result = await manager
    .createQueryBuilder()
    .delete()
    .from(target)
    .where(where)
    .returning("*")
    .execute();

  return (result.raw as Row[]).map((row) => hydrate<E>(manager, metadata, row));
}
