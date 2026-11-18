import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { CustomFieldValueEntity } from "../../database/entities/custom-field-value.entity";

export async function insertCustomFieldValues(
  tx: EntityManager,
  values: { taskId: string; fieldId: string; value: string }[],
): Promise<void> {
  if (!values.length) return;
  await tx
    .createQueryBuilder()
    .insert()
    .into(CustomFieldValueEntity)
    .values(values.map((value) => ({ id: createId(), ...value })))
    .updateEntity(false)
    .execute();
}
