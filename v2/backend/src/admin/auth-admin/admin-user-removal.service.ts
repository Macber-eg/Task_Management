import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { DataSource } from "typeorm";
import { hasInstanceAdminRole } from "../../access/instance-admin-role";
import { Authenticator } from "../../auth/authenticator";
import { SessionService } from "../../auth/sessions/session.service";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { RealtimeConnections } from "../../realtime/realtime-connections";
import { AccountDataDeletionService } from "../account-deletion/account-data-deletion.service";
import { adminError } from "./admin-error";
import { hasAdminPermission } from "./admin-permission";
import { assertUserExists } from "./assert-user-exists";

/**
 * Deletes another person's account. The caller is checked before anything
 * else, signed in or not, so a refusal never says whether the target exists.
 */
@Injectable()
export class AdminUserRemovalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authenticator: Authenticator,
    private readonly sessions: SessionService,
    private readonly realtime: RealtimeConnections,
    private readonly accountData: AccountDataDeletionService,
  ) {}

  async removeUser(request: Request, body: { userId?: unknown }) {
    const principal = await this.authenticator.authenticate(request);
    const caller = principal?.session ? principal.user : null;
    if (!caller || !hasInstanceAdminRole(caller.role)) {
      throw adminError("INSTANCE_ADMIN_REQUIRED");
    }

    const requested = body.userId;
    if (typeof requested === "string" && requested !== "") {
      if (requested === caller.id) throw adminError("CANNOT_REMOVE_YOURSELF");
      await this.accountData.deleteAccountData(requested);
    }

    // The previous backend's auth library coerced the id to a string.
    const userId = String(requested);
    if (!hasAdminPermission(caller.role, { user: ["delete"] })) {
      throw adminError("YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS");
    }
    if (userId === caller.id) throw adminError("YOU_CANNOT_REMOVE_YOURSELF");
    await assertUserExists(this.dataSource, userId);

    await this.sessions.revokeAllForUser(userId);
    const manager = this.dataSource.manager;
    await manager.delete(AccountEntity, { userId });
    await manager.delete(UserEntity, { id: userId });
    await this.realtime.revokeUserConnections(userId);
    return { success: true };
  }
}
