import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { instanceAdminRoleSql } from "../../access/instance-admin-role";

const NON_ANONYMOUS = "is_anonymous IS NOT TRUE";

@Injectable()
export class InstanceBootstrapService {
  constructor(private readonly dataSource: DataSource) {}

  /** False on a fresh instance: the next sign-up becomes its administrator. */
  async hasRegisteredUsers(): Promise<boolean> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS value FROM "user" WHERE ${NON_ANONYMOUS}`,
    )) as { value: number }[];
    return (row?.value ?? 0) > 0;
  }

  async promoteInitialAdministrator(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(2026)");
      const admins = (await manager.query(
        `SELECT id FROM "user"
         WHERE ${NON_ANONYMOUS} AND ${instanceAdminRoleSql("role")} LIMIT 1`,
      )) as unknown[];
      if (admins.length > 0) return;

      // Elect the earliest registered user, not the only row: concurrent
      // first sign-ups may both be inserted before either reaches this lock.
      // Anonymous rows never consume the initial-admin slot.
      const [first] = (await manager.query(
        `SELECT id FROM "user" WHERE ${NON_ANONYMOUS}
         ORDER BY created_at ASC, id ASC LIMIT 1`,
      )) as { id: string }[];
      if (first?.id !== userId) return;

      await manager.query(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [
        userId,
      ]);
    });
  }
}
