import type { EntityManager } from "typeorm";
import { TaskRelationEntity } from "../../database/entities/task-relation.entity";
import { chunk } from "./chunk";
import { insertRows } from "./insert-rows";
import type { PlannedImportRelation } from "./plan-import-relations";

export async function writeImportRelations(
  tx: EntityManager,
  relations: readonly PlannedImportRelation[],
): Promise<number> {
  for (const batch of chunk(relations)) {
    await insertRows(tx, TaskRelationEntity, batch);
  }
  return relations.length;
}
