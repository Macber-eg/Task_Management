import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ApiError } from "../../common/errors/api-error";
import { insertReturning } from "../../database/dml";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { InstanceBootstrapService } from "../instance/instance-bootstrap.service";
import { assertUserRegistrationAllowed } from "../registration/registration-policy";
import {
  isVerified,
  type OAuthAccountData,
  type OAuthUserInfo,
} from "./oauth-identity";

export type RegistrationContext = {
  /** The callback route, relative to `/api/auth`, for the registration policy. */
  path: string;
  invitationId?: unknown;
};

export type RegistrationResult =
  | { user: UserEntity; error?: undefined }
  | { user?: undefined; error: string };

const DEFAULT_ROLE = "user";

/**
 * Creates the account of someone signing in through a provider for the first
 * time. Refusals come back as the message the callback puts in its error
 * redirect, as they did before.
 */
@Injectable()
export class OAuthRegistrationService {
  private readonly logger = new Logger(OAuthRegistrationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly bootstrap: InstanceBootstrapService,
  ) {}

  async register(
    userInfo: OAuthUserInfo,
    account: OAuthAccountData,
    context: RegistrationContext,
  ): Promise<RegistrationResult> {
    const email = userInfo.email.toLowerCase();
    const emailVerified = isVerified(userInfo.emailVerified);

    let user: UserEntity | undefined;
    try {
      await assertUserRegistrationAllowed(
        this.dataSource.manager,
        { email, emailVerified },
        context,
      );
      user = await this.dataSource.transaction(async (manager) => {
        const created = await insertReturning(manager, UserEntity, {
          name: userInfo.name,
          email,
          emailVerified,
          image: typeof userInfo.image === "string" ? userInfo.image : null,
          // The profile's `locale` claim is the one provider field the user
          // table accepts.
          ...(typeof userInfo.locale === "string"
            ? { locale: userInfo.locale }
            : {}),
          role: DEFAULT_ROLE,
        });
        if (!created) return undefined;
        await insertReturning(manager, AccountEntity, {
          ...account,
          userId: created.id,
        });
        return created;
      });
    } catch (error) {
      // A refusal by the registration policy is an answer, not a failure.
      if (error instanceof ApiError) return { error: error.message };
      this.logger.error("OAuth user creation failed", error);
      return { error: "unable to create user" };
    }
    if (!user) return { error: "unable to create user" };

    await this.bootstrap.promoteInitialAdministrator(user.id);
    const fresh = await this.dataSource.manager.findOne(UserEntity, {
      where: { id: user.id },
    });
    return { user: fresh ?? user };
  }
}
