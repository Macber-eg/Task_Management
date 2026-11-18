import type { DataSource } from "typeorm";
import {
  hasInstanceAdminRole,
  instanceAdminRoleSql,
} from "../../access/instance-admin-role";
import { updateReturning } from "../../database/dml";
import { UserEntity } from "../../database/entities/user.entity";
import { adminError } from "./admin-error";

// Shared with every API instance, so role removals are serialized instance-wide.
const LAST_ADMIN_LOCK = "SELECT pg_advisory_xact_lock(2026, 1732)";

/**
 * Writes a user. A write that takes the admin role away runs under an
 * advisory lock, counting the remaining administrators in the same
 * transaction, so two admins demoting each other cannot both succeed.
 */
export async function guardedUserUpdate(
  dataSource: DataSource,
  userId: string,
  values: Partial<UserEntity>,
): Promise<UserEntity | undefined> {
  if (!Object.hasOwn(values, "role") || hasInstanceAdminRole(values.role)) {
    const [user] = await updateReturning(
      dataSource.manager,
      UserEntity,
      values,
      { id: userId },
    );
    return user;
  }

  return dataSource.transaction(async (manager) => {
    await manager.query(LAST_ADMIN_LOCK);
    const [target] = (await manager.query(
      `SELECT role FROM "user" WHERE id = $1`,
      [userId],
    )) as { role: string | null }[];

    if (hasInstanceAdminRole(target?.role)) {
      const [admins] = (await manager.query(
        `SELECT count(*)::int AS value FROM "user" WHERE ${instanceAdminRoleSql("role")}`,
      )) as { value: number }[];
      if ((admins?.value ?? 0) <= 1) throw adminError("CANNOT_REMOVE_LAST_ADMIN");
    }

    const [user] = await updateReturning(manager, UserEntity, values, {
      id: userId,
    });
    return user;
  });
}
