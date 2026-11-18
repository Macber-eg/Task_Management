import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { updateReturning } from "../../database/dml";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { authError } from "../auth-error";
import { CREDENTIAL_PROVIDER } from "../email-password/sign-up.service";
import { PasswordService } from "../password/password.service";
import { SessionService } from "../sessions/session.service";

export type ProfileUpdate = {
  name?: string;
  image?: string | null;
  locale?: string | null;
};

@Injectable()
export class AccountService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async updateProfile(userId: string, update: ProfileUpdate): Promise<void> {
    const changes: ProfileUpdate = {};
    if (update.name !== undefined) changes.name = update.name;
    if (update.image !== undefined) changes.image = update.image;
    if (update.locale !== undefined) changes.locale = update.locale;
    if (Object.keys(changes).length === 0) return;

    await updateReturning(this.dataSource.manager, UserEntity, changes, {
      id: userId,
    });
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    input: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    },
  ): Promise<void> {
    this.passwords.assertAcceptable(input.newPassword);

    const manager = this.dataSource.manager;
    const account = await manager.findOne(AccountEntity, {
      where: { userId, providerId: CREDENTIAL_PROVIDER },
    });
    if (!account?.password) throw authError("CREDENTIAL_ACCOUNT_NOT_FOUND");

    if (!(await this.passwords.verify(account.password, input.currentPassword))) {
      throw authError("INVALID_PASSWORD");
    }

    await updateReturning(
      manager,
      AccountEntity,
      { password: await this.passwords.hash(input.newPassword) },
      { id: account.id },
    );

    if (input.revokeOtherSessions) {
      await this.sessions.revokeAllForUser(userId, currentSessionId);
    }
  }

  async listAccounts(userId: string) {
    const accounts = await this.dataSource.manager.find(AccountEntity, {
      where: { userId },
    });
    return accounts.map((account) => ({
      id: account.id,
      providerId: account.providerId,
      accountId: account.accountId,
      userId: account.userId,
      scopes: account.scope ? account.scope.split(",") : [],
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    }));
  }
}
