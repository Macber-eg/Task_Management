import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { updateReturning } from "../../database/dml";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { authError } from "../auth-error";
import { CREDENTIAL_PROVIDER } from "../email-password/sign-up.service";
import { SessionService } from "../sessions/session.service";

/** What has to hold before a passwordless sign-in may start a session. */
@Injectable()
export class SessionEligibilityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  /**
   * A mailbox proof (sign-in code or magic link) for an account whose email
   * was never verified: whoever set its password or holds its sessions may
   * not be the mailbox owner, so both are removed before it is marked
   * verified.
   */
  async proveEmailOwnership(user: UserEntity): Promise<UserEntity> {
    if (user.emailVerified) return user;
    const manager = this.dataSource.manager;
    await manager.delete(AccountEntity, {
      userId: user.id,
      providerId: CREDENTIAL_PROVIDER,
    });
    await this.sessions.revokeAllForUser(user.id);
    const [verified] = await updateReturning(
      manager,
      UserEntity,
      { emailVerified: true },
      { id: user.id },
    );
    return verified ?? { ...user, emailVerified: true };
  }

  /** Refuses a banned user; a ban that has run out is lifted instead. */
  async assertNotBanned(user: UserEntity): Promise<UserEntity> {
    if (!user.banned) return user;
    if (user.banExpires && user.banExpires.getTime() < Date.now()) {
      const [unbanned] = await updateReturning(
        this.dataSource.manager,
        UserEntity,
        { banned: false, banReason: null, banExpires: null },
        { id: user.id },
      );
      return unbanned ?? user;
    }
    throw authError("BANNED_USER");
  }
}
