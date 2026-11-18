import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { z } from "zod";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { authError } from "../auth-error";
import { isBanActive } from "../is-ban-active";
import { PasswordService } from "../password/password.service";
import { CREDENTIAL_PROVIDER } from "./sign-up.service";

@Injectable()
export class SignInService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
  ) {}

  async signIn(rawEmail: string, password: string): Promise<UserEntity> {
    if (process.env.DISABLE_LOGIN_FORM === "true") {
      throw authError("LOCAL_SIGN_IN_DISABLED");
    }

    const email = rawEmail.toLowerCase();
    if (!z.email().safeParse(email).success) throw authError("INVALID_EMAIL");

    const manager = this.dataSource.manager;
    const user = await manager.findOne(UserEntity, { where: { email } });
    const account = user
      ? await manager.findOne(AccountEntity, {
          where: { userId: user.id, providerId: CREDENTIAL_PROVIDER },
        })
      : null;

    if (!user || !account?.password) {
      // Spend the same time as a real check, so response time does not
      // reveal whether the address has an account.
      await this.passwords.hash(password);
      throw authError("INVALID_EMAIL_OR_PASSWORD");
    }

    if (!(await this.passwords.verify(account.password, password))) {
      throw authError("INVALID_EMAIL_OR_PASSWORD");
    }

    if (isBanActive(user)) throw authError("BANNED_USER");
    return user;
  }
}
