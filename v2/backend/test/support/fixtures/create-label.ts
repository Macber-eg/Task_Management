import type { EntityManager } from "typeorm";
import { LabelEntity } from "../../../src/database/entities/label.entity";
import { insertRow } from "./insert-row";

/** A workspace label, or a task's copy of one when `taskId` is given. */
export function createLabel(
  db: EntityManager,
  values: Partial<LabelEntity> & { workspaceId: string; name: string },
): Promise<LabelEntity> {
  return insertRow(db, LabelEntity, { color: "#ef4444", ...values });
}
