import type { EntityManager, EntityTarget, ObjectLiteral } from "typeorm";
import { insertReturning } from "../../../src/database/dml";

/** Inserts one fixture row and returns it as stored. */
export async function insertRow<E extends ObjectLiteral>(
  db: EntityManager,
  entity: EntityTarget<E>,
  values: Partial<E>,
): Promise<E> {
  const row = await insertReturning(db, entity, values);
  if (!row) throw new Error("Fixture insert returned no row");
  return row;
}
