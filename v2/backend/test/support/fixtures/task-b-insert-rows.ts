import { createId } from "@paralleldrive/cuid2";
import type { EntityManager, EntityTarget, ObjectLiteral } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/**
 * Inserts many fixture rows in one statement (each gets a cuid2 `id` unless
 * given one) and returns their ids in order.
 */
export async function insertRows<E extends ObjectLiteral>(
  db: EntityManager,
  entity: EntityTarget<E>,
  rows: Partial<E>[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const values = rows.map((row) => ({ id: createId(), ...row }));
  await db
    .createQueryBuilder()
    .insert()
    .into(entity)
    .values(values as unknown as QueryDeepPartialEntity<E>[])
    .updateEntity(false)
    .execute();
  return values.map((row) => row.id as string);
}
