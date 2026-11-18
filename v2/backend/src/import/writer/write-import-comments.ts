import type { EntityManager } from "typeorm";
import { ActivityEntity } from "../../database/entities/activity.entity";
import { chunk } from "./chunk";
import { insertRows } from "./insert-rows";
import {
  type PlannedImportComment,
  planImportComments,
} from "./plan-import-comments";

export async function writeImportComments(
  tx: EntityManager,
  input: Parameters<typeof planImportComments>[0],
): Promise<number> {
  const rows: PlannedImportComment[] = planImportComments(input);
  for (const batch of chunk(rows)) {
    await insertRows(tx, ActivityEntity, batch);
  }
  return rows.length;
}
