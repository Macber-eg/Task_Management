import type { EntityManager } from "typeorm";

/** The language an address's account chose, or null without an account. */
export async function getUserLocale(
  manager: EntityManager,
  email: string,
): Promise<string | null> {
  const [user] = (await manager.query(
    `SELECT locale FROM "user" WHERE email = $1 LIMIT 1`,
    [email],
  )) as { locale: string | null }[];
  return user?.locale ?? null;
}
