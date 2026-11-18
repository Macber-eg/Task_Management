import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../src/database/dml";
import { WorkspaceBillingEntity } from "../../../src/database/entities/workspace-billing.entity";

/** Creates or overwrites a workspace's billing row with these values. */
export async function setBilling(
  db: EntityManager,
  workspaceId: string,
  values: Partial<WorkspaceBillingEntity>,
): Promise<void> {
  const existing = await db.findOne(WorkspaceBillingEntity, {
    where: { workspaceId },
  });
  if (existing) {
    await db.update(WorkspaceBillingEntity, { workspaceId }, values);
    return;
  }
  await insertReturning(db, WorkspaceBillingEntity, { workspaceId, ...values });
}

export async function readBilling(
  db: EntityManager,
  workspaceId: string,
): Promise<WorkspaceBillingEntity> {
  return db.findOneOrFail(WorkspaceBillingEntity, { where: { workspaceId } });
}
