import { createId } from "@paralleldrive/cuid2";
import type { EntityManager, EntityTarget, ObjectLiteral } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/**
 * Inserts many fixture rows in one statement (a cuid `id` unless given) and
 * returns their ids in order. For seeds too large for one insert per row.
 */
export async function insertRows<E extends ObjectLiteral>(
  db: EntityManager,
  entity: EntityTarget<E>,
  rows: Partial<E>[],
): Promise<string[]> {
  const values = rows.map((row) => ({ id: createId(), ...row }));
  for (let index = 0; index < values.length; index += 500) {
    await db
      .createQueryBuilder()
      .insert()
      .into(entity)
      .values(values.slice(index, index + 500) as QueryDeepPartialEntity<E>[])
      .updateEntity(false)
      .execute();
  }
  return values.map((row) => row.id as string);
}
