import type { DataSource } from "typeorm";
import { adminError } from "./admin-error";

export async function assertUserExists(
  dataSource: DataSource,
  userId: string,
): Promise<void> {
  const rows = (await dataSource.query(
    `SELECT id FROM "user" WHERE id = $1 LIMIT 1`,
    [userId],
  )) as unknown[];
  if (rows.length === 0) throw adminError("USER_NOT_FOUND");
}
