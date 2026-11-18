import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { z } from "zod";
import { insertReturning } from "../../database/dml";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { authError } from "../auth-error";
import { InstanceBootstrapService } from "../instance/instance-bootstrap.service";
import { PasswordService } from "../password/password.service";
import { assertEmailSignUpAllowed } from "../registration/assert-email-sign-up-allowed";
import { assertUserRegistrationAllowed } from "../registration/registration-policy";
import type { SignUpInvitation } from "./sign-up-invitation";

export const CREDENTIAL_PROVIDER = "credential";

/** The route, relative to `/api/auth`, the registration policy is told about. */
const SIGN_UP_PATH = "/sign-up/email";

const UNIQUE_VIOLATION = "23505";

export type SignUpInput = {
  name: string;
  email: string;
  password: string;
  image?: string | null;
  locale?: string | null;
};

@Injectable()
export class SignUpService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly bootstrap: InstanceBootstrapService,
  ) {}

  async signUp(
    input: SignUpInput,
    invitation: SignUpInvitation = {},
  ): Promise<UserEntity> {
    // The registration policy runs before the input is checked, as it did
    // in the previous API. The first account on an instance becomes its
    // administrator and is exempt from it.
    await assertEmailSignUpAllowed(this.dataSource.manager, {
      isInstanceAdminSetup: !(await this.bootstrap.hasRegisteredUsers()),
      email: input.email,
      invitationEmail: invitation.email,
      invitationId: invitation.invitationId,
    });

    const email = input.email.toLowerCase();
    if (!z.email().safeParse(email).success) throw authError("INVALID_EMAIL");
    this.passwords.assertAcceptable(input.password);

    const existing = await this.dataSource.manager.findOne(UserEntity, {
      where: { email },
    });
    if (existing) throw authError("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");

    const passwordHash = await this.passwords.hash(input.password);

    // Checked again right before the row is written, as account creation
    // was guarded on every path in the previous API.
    await assertUserRegistrationAllowed(
      this.dataSource.manager,
      { email, emailVerified: false },
      { path: SIGN_UP_PATH, invitationId: invitation.invitationId },
    );

    let user: UserEntity | undefined;
    try {
      user = await this.dataSource.transaction(async (manager) => {
        const created = await insertReturning(manager, UserEntity, {
          name: input.name,
          email,
          emailVerified: false,
          image: input.image ?? null,
          locale: input.locale ?? null,
          // Every new account gets the instance role `user` (`admin` comes
          // from the first-user promotion), as with the other sign-up paths.
          role: "user",
        });
        if (!created) return undefined;
        await insertReturning(manager, AccountEntity, {
          accountId: created.id,
          providerId: CREDENTIAL_PROVIDER,
          userId: created.id,
          password: passwordHash,
        });
        return created;
      });
    } catch (error) {
      // Two sign-ups for one address can both pass the lookup above.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw authError("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
      }
      throw error;
    }
    if (!user) throw authError("FAILED_TO_CREATE_USER");

    await this.bootstrap.promoteInitialAdministrator(user.id);
    return (
      (await this.dataSource.manager.findOne(UserEntity, {
        where: { id: user.id },
      })) ?? user
    );
  }
}
