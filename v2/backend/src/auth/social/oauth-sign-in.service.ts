import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning, updateReturning } from "../../database/dml";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import {
  freshTokenColumns,
  isVerified,
  type OAuthAccountData,
  type OAuthUserInfo,
} from "./oauth-identity";
import {
  OAuthRegistrationService,
  type RegistrationContext,
} from "./oauth-registration.service";

export type OAuthSignInResult =
  | { user: UserEntity; isRegister: boolean; error?: undefined }
  | { user?: undefined; error: string };

type KnownUser = { user: UserEntity; linkedAccount: AccountEntity | null };

/**
 * Resolves who a provider identity signs in as. An identity already linked
 * signs in as its user; an unlinked one is linked to the account with the
 * same email only when the provider verified that email and the local
 * account's email is verified too (otherwise someone could pre-register a
 * victim's address and keep access after the victim signs in); an unknown
 * one registers a new user.
 */
@Injectable()
export class OAuthSignInService {
  private readonly logger = new Logger(OAuthSignInService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly registration: OAuthRegistrationService,
  ) {}

  async signIn(
    userInfo: OAuthUserInfo,
    account: OAuthAccountData,
    context: RegistrationContext,
  ): Promise<OAuthSignInResult> {
    const known = await this.findUser(userInfo.email, account);
    if (!known) {
      const registered = await this.registration.register(
        userInfo,
        account,
        context,
      );
      return registered.user
        ? { user: registered.user, isRegister: true }
        : { error: registered.error };
    }

    const manager = this.dataSource.manager;
    let { user } = known;
    if (!known.linkedAccount) {
      if (!isVerified(userInfo.emailVerified) || !user.emailVerified) {
        return { error: "account not linked" };
      }
      try {
        await insertReturning(manager, AccountEntity, {
          ...account,
          accountId: String(userInfo.id),
          userId: user.id,
        });
      } catch (error) {
        this.logger.error("Unable to link account", error);
        return { error: "unable to link account" };
      }
    } else {
      const columns = freshTokenColumns(account);
      if (Object.keys(columns).length > 0) {
        await updateReturning(manager, AccountEntity, columns, {
          id: known.linkedAccount.id,
        });
      }
      if (
        isVerified(userInfo.emailVerified) &&
        !user.emailVerified &&
        userInfo.email.toLowerCase() === user.email
      ) {
        const [updated] = await updateReturning(
          manager,
          UserEntity,
          { emailVerified: true },
          { id: user.id },
        );
        user = updated ?? user;
      }
    }
    return { user, isRegister: false };
  }

  private async findUser(
    email: string,
    account: OAuthAccountData,
  ): Promise<KnownUser | null> {
    const manager = this.dataSource.manager;
    const linked = await manager.findOne(AccountEntity, {
      where: { accountId: account.accountId, providerId: account.providerId },
      relations: { user: true },
    });
    if (linked?.user) return { user: linked.user, linkedAccount: linked };

    const user = await manager.findOne(UserEntity, {
      where: { email: email.toLowerCase() },
    });
    return user ? { user, linkedAccount: null } : null;
  }
}
