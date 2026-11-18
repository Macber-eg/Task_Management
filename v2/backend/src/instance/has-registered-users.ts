import type { EntityManager } from "typeorm";

/** Guest accounts never count as registered users. */
export const NON_ANONYMOUS_USER_SQL = "is_anonymous IS NOT TRUE";

export async function hasRegisteredUsers(
  manager: EntityManager,
): Promise<boolean> {
  const rows = (await manager.query(
    `SELECT 1 FROM "user" WHERE ${NON_ANONYMOUS_USER_SQL} LIMIT 1`,
  )) as unknown[];
  return rows.length > 0;
}
