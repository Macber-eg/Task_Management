import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { z } from "zod";
import { SessionService } from "../../auth/sessions/session.service";
import { userOutput } from "../../auth/sessions/session-output";
import type { UserEntity } from "../../database/entities/user.entity";
import { adminError } from "./admin-error";
import { hasAdminPermission } from "./admin-permission";
import { assertUserExists } from "./assert-user-exists";
import { pickWritableUserData } from "./admin-user-data";
import { guardedUserUpdate } from "./guarded-user-update";
import type { AdminCaller } from "./require-admin-login";

const BAN_FIELDS = ["banned", "banReason", "banExpires"];

function joinRoles(role: unknown): unknown {
  return Array.isArray(role) ? role.join(",") : role;
}

/** An administrator's changes to another account: profile, email, role. */
@Injectable()
export class AdminUserUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  async setRole(
    caller: AdminCaller,
    { userId, role }: { userId: string; role: string | string[] },
  ) {
    if (!hasAdminPermission(caller.user.role, { user: ["set-role"] })) {
      throw adminError("YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE");
    }
    await assertUserExists(this.dataSource, userId);
    const user = await this.write(caller, userId, {
      role: joinRoles(role) as string,
    });
    return { user: userOutput(user) };
  }

  async updateUser(
    caller: AdminCaller,
    { userId, data }: { userId: string; data: Record<string, unknown> },
  ) {
    const allows = (actions: string[]) =>
      hasAdminPermission(caller.user.role, { user: actions });
    const has = (key: string) => Object.hasOwn(data, key);

    if (!allows(["update"])) {
      throw adminError("YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS");
    }
    if (Object.keys(data).length === 0) throw adminError("NO_DATA_TO_UPDATE");
    if (has("password")) {
      throw adminError("PASSWORD_CANNOT_BE_UPDATED_VIA_UPDATE_USER");
    }
    if (has("role")) {
      if (!allows(["set-role"])) {
        throw adminError("YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE");
      }
      const roles = Array.isArray(data.role) ? data.role : [data.role];
      if (roles.some((role) => typeof role !== "string")) {
        throw adminError("INVALID_ROLE_TYPE");
      }
      data.role = roles.join(",");
    }
    if (BAN_FIELDS.some(has)) {
      if (!allows(["ban"])) throw adminError("YOU_ARE_NOT_ALLOWED_TO_BAN_USERS");
      if (data.banned === true && userId === caller.user.id) {
        throw adminError("YOU_CANNOT_BAN_YOURSELF");
      }
    }
    if (has("email") || has("emailVerified")) {
      if (!allows(["set-email"])) {
        throw adminError("YOU_ARE_NOT_ALLOWED_TO_SET_USERS_EMAIL");
      }
      if (has("email")) {
        const email = String(data.email).toLowerCase();
        if (!z.email().safeParse(email).success) {
          throw adminError("INVALID_EMAIL");
        }
        const owner = await this.findUserIdByEmail(email);
        if (owner && owner !== userId) {
          throw adminError("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
        }
        data.email = email;
      }
    }
    await assertUserExists(this.dataSource, userId);

    let values = pickWritableUserData(data);
    if (has("email")) values = await this.clearVerificationOnNewEmail(userId, values);
    const user = await this.write(caller, userId, values);
    if (data.banned === true) await this.sessions.revokeAllForUser(userId);
    return userOutput(user);
  }

  private async write(
    caller: AdminCaller,
    userId: string,
    values: Partial<UserEntity>,
  ): Promise<UserEntity> {
    if (Object.hasOwn(values, "role") && userId === caller.user.id) {
      throw adminError("YOU_CANNOT_CHANGE_YOUR_OWN_ROLE");
    }
    const user = await guardedUserUpdate(this.dataSource, userId, values);
    if (!user) throw adminError("USER_NOT_FOUND");
    return user;
  }

  // A changed address is unverified until its owner confirms it; a change of
  // case or surrounding spaces is not a new address.
  private async clearVerificationOnNewEmail(
    userId: string,
    values: Partial<UserEntity>,
  ): Promise<Partial<UserEntity>> {
    const [current] = (await this.dataSource.query(
      `SELECT email FROM "user" WHERE id = $1 LIMIT 1`,
      [userId],
    )) as { email: string }[];
    if (!current) return values;
    const next = String(values.email ?? "")
      .trim()
      .toLowerCase();
    if (next === current.email.trim().toLowerCase()) return values;
    return { ...values, emailVerified: false };
  }

  private async findUserIdByEmail(email: string): Promise<string | null> {
    const [user] = (await this.dataSource.query(
      `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
      [email],
    )) as { id: string }[];
    return user?.id ?? null;
  }
}
