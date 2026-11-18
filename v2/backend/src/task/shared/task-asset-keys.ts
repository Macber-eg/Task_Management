import type { EntityManager } from "typeorm";

/** Stored object keys of every asset attached to the given tasks. */
export async function findTaskAssetKeys(
  tx: EntityManager,
  taskIds: string[],
): Promise<string[]> {
  const assets = (await tx.query(
    `SELECT object_key AS "objectKey" FROM asset WHERE task_id = ANY($1::text[])`,
    [taskIds],
  )) as { objectKey: string }[];
  return assets.map((asset) => asset.objectKey);
}
