import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ApiError } from "../../common/errors/api-error";
import { AccountEntity } from "../../database/entities/account.entity";
import type { SessionEntity } from "../../database/entities/session.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { RealtimeConnections } from "../../realtime/realtime-connections";
import { authError } from "../auth-error";
import { CREDENTIAL_PROVIDER } from "../email-password/sign-up.service";
import { PasswordService } from "../password/password.service";
import { VerificationStore } from "../verification/verification-store.service";
import { AccountDataDeletionService } from "../../admin/account-deletion/account-data-deletion.service";

// Without a password, only a login younger than this may delete the account.
const FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

export type DeleteUserInput = { password?: string; token?: string };

@Injectable()
export class DeleteUserService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly verifications: VerificationStore,
    private readonly accountData: AccountDataDeletionService,
    private readonly realtime: RealtimeConnections,
  ) {}

  async deleteUser(
    user: UserEntity,
    session: SessionEntity,
    input: DeleteUserInput,
  ) {
    if (input.password) await this.verifyPassword(user.id, input.password);

    if (input.token) {
      // Deletion links are never emailed on this instance, so no token can
      // match; the check is kept for the route's contract.
      const verification = await this.verifications.consume(
        `delete-account-${input.token}`,
      );
      if (!verification || verification.value !== user.id) {
        throw new ApiError(404, { code: "INVALID_TOKEN", message: "Invalid token" });
      }
    } else if (
      !input.password &&
      Date.now() - session.createdAt.getTime() >= FRESH_SESSION_MS
    ) {
      throw new ApiError(400, {
        code: "SESSION_EXPIRED",
        message: "Session expired. Re-authenticate to perform this action.",
      });
    }

    await this.accountData.deleteAccountData(user.id);
    // Sessions, accounts and memberships go with the row.
    await this.dataSource.manager.delete(UserEntity, { id: user.id });
    await this.realtime.revokeUserConnections(user.id);
    return { success: true, message: "User deleted" };
  }

  private async verifyPassword(userId: string, password: string) {
    const account = await this.dataSource.manager.findOne(AccountEntity, {
      where: { userId, providerId: CREDENTIAL_PROVIDER },
    });
    if (!account?.password) throw authError("CREDENTIAL_ACCOUNT_NOT_FOUND");
    if (!(await this.passwords.verify(account.password, password))) {
      throw authError("INVALID_PASSWORD");
    }
  }
}
