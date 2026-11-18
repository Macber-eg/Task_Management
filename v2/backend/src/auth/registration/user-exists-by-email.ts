import type { EntityManager } from "typeorm";

export async function userExistsByEmail(
  manager: EntityManager,
  email: string,
): Promise<boolean> {
  const rows = (await manager.query(
    `SELECT 1 FROM "user" WHERE email = $1 LIMIT 1`,
    [email.toLowerCase()],
  )) as unknown[];
  return rows.length > 0;
}
