import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { SessionService } from "../../auth/sessions/session.service";
import { userOutput } from "../../auth/sessions/session-output";
import { updateReturning } from "../../database/dml";
import { UserEntity } from "../../database/entities/user.entity";
import { adminError } from "./admin-error";
import { hasAdminPermission } from "./admin-permission";
import { assertUserExists } from "./assert-user-exists";
import type { AdminCaller } from "./require-admin-login";

/**
 * Deactivating an account: a ban ends every login at once (and the sockets
 * they opened); lifting it lets the person sign in again.
 */
@Injectable()
export class AdminBanService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  async ban(
    caller: AdminCaller,
    request: { userId: string; banReason?: string; banExpiresIn?: number },
  ) {
    this.assertCanBan(caller);
    await assertUserExists(this.dataSource, request.userId);
    if (request.userId === caller.user.id) {
      throw adminError("YOU_CANNOT_BAN_YOURSELF");
    }
    const user = await this.update(request.userId, {
      banned: true,
      banReason: request.banReason || "No reason",
      ...(request.banExpiresIn
        ? { banExpires: new Date(Date.now() + request.banExpiresIn * 1000) }
        : {}),
    });
    await this.sessions.revokeAllForUser(request.userId);
    return { user: userOutput(user) };
  }

  async unban(caller: AdminCaller, { userId }: { userId: string }) {
    this.assertCanBan(caller);
    await assertUserExists(this.dataSource, userId);
    const user = await this.update(userId, {
      banned: false,
      banExpires: null,
      banReason: null,
    });
    return { user: userOutput(user) };
  }

  private assertCanBan(caller: AdminCaller) {
    if (!hasAdminPermission(caller.user.role, { user: ["ban"] })) {
      throw adminError("YOU_ARE_NOT_ALLOWED_TO_BAN_USERS");
    }
  }

  private async update(userId: string, values: Partial<UserEntity>) {
    const [user] = await updateReturning(
      this.dataSource.manager,
      UserEntity,
      values,
      { id: userId },
    );
    if (!user) throw adminError("USER_NOT_FOUND");
    return user;
  }
}
