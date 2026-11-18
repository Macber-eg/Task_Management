import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning, updateReturning } from "../../database/dml";
import { AccountEntity } from "../../database/entities/account.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { getAuthEmailCopy } from "../../email/auth-email-copy";
import { BackgroundEmailDeliveries } from "../../email/background-email-deliveries";
import { EmailService } from "../../email/email.service";
import { getEmailRequestContext } from "../../email/email-request-context";
import { getUserLocale } from "../../email/get-user-locale";
import { ALPHANUMERIC, randomString } from "../api-key/random-string";
import { authError } from "../auth-error";
import { CREDENTIAL_PROVIDER } from "../email-password/sign-up.service";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordService,
} from "../password/password.service";
import { SessionService } from "../sessions/session.service";
import { authBaseURL } from "../social/auth-urls";
import { VerificationStore } from "../verification/verification-store.service";

const TOKEN_TTL_MS = 60 * 60 * 1000;
const CONFIRMATION =
  "If this email exists in our system, check your email for the reset link";

const identifierOf = (token: string) => `reset-password:${token}`;

function withQuery(url: URL, query: Record<string, string>): string {
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly verifications: VerificationStore,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly emails: EmailService,
    private readonly deliveries: BackgroundEmailDeliveries,
  ) {}

  /**
   * Emails a one-hour reset link. The answer is the same whether or not the
   * address has an account, and the email goes out after the response.
   */
  async request(email: string, redirectTo: string | undefined, userAgent?: string) {
    const manager = this.dataSource.manager;
    const user = await manager.findOne(UserEntity, {
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      // A lookup like a real request's, so timing says less about the address.
      await this.verifications.findLatest("dummy-verification-token");
      return { status: true, message: CONFIRMATION };
    }

    const token = randomString(24, ALPHANUMERIC);
    await this.verifications.create(
      identifierOf(token),
      user.id,
      new Date(Date.now() + TOKEN_TTL_MS),
    );
    const callbackURL = redirectTo ? encodeURIComponent(redirectTo) : "";
    const url = `${authBaseURL()}/reset-password/${token}?callbackURL=${callbackURL}`;
    const context = getEmailRequestContext(userAgent);

    this.deliveries.queue(async () => {
      const locale = await getUserLocale(manager, user.email);
      await this.emails.sendPasswordResetEmail(
        user.email,
        getAuthEmailCopy(locale).passwordResetSubject,
        { resetLink: url, userName: user.name, locale, ...context },
      );
    }, "Password reset email preparation failed");

    return { status: true, message: CONFIRMATION };
  }

  /** Where the emailed link sends the browser: the reset form, or an error. */
  async callbackLocation(token: string, callbackURL: string): Promise<string> {
    const base = authBaseURL();
    const invalid = () =>
      withQuery(
        callbackURL ? new URL(callbackURL, base) : new URL(`${base}/error`),
        { error: "INVALID_TOKEN" },
      );
    if (!token || !callbackURL) return invalid();

    const verification = await this.verifications.findLatest(
      identifierOf(token),
    );
    if (!verification || verification.expiresAt < new Date()) return invalid();
    return withQuery(new URL(callbackURL, base), { token });
  }

  /** Sets the new password once per token and signs the user out everywhere. */
  async reset(token: string | undefined, newPassword: string) {
    if (!token) throw authError("INVALID_TOKEN");
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw authError("PASSWORD_TOO_SHORT");
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      throw authError("PASSWORD_TOO_LONG");
    }

    const verification = await this.verifications.consume(identifierOf(token));
    if (!verification) throw authError("INVALID_TOKEN");
    const userId = verification.value;
    const password = await this.passwords.hash(newPassword);

    const manager = this.dataSource.manager;
    const credential = await manager.findOne(AccountEntity, {
      where: { userId, providerId: CREDENTIAL_PROVIDER },
    });
    if (credential) {
      await updateReturning(
        manager,
        AccountEntity,
        { password },
        { userId, providerId: CREDENTIAL_PROVIDER },
      );
    } else {
      await insertReturning(manager, AccountEntity, {
        userId,
        providerId: CREDENTIAL_PROVIDER,
        accountId: userId,
        password,
      });
    }

    await this.sessions.revokeAllForUser(userId);
    return { status: true };
  }
}
