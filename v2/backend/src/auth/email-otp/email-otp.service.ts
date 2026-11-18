import { Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { DataSource } from "typeorm";
import { z } from "zod";
import { HTTPException } from "../../common/errors/http-exception";
import { UserEntity } from "../../database/entities/user.entity";
import { getAuthEmailCopy } from "../../email/auth-email-copy";
import { BackgroundEmailDeliveries } from "../../email/background-email-deliveries";
import { EmailService } from "../../email/email.service";
import { getEmailRequestContext } from "../../email/email-request-context";
import { getUserLocale } from "../../email/get-user-locale";
import { authError } from "../auth-error";
import { CurrentSessionService } from "../sessions/current-session.service";
import { userOutput } from "../sessions/session-output";
import { requestInvitationId } from "../sign-in-policy/request-invitation-id";
import { SessionEligibilityService } from "../sign-in-policy/session-eligibility.service";
import { shouldDeliverSignInEmail } from "../sign-in-policy/should-deliver-sign-in-email";
import { UserRegistrationService } from "../sign-in-policy/user-registration.service";
import { OtpCodes, type OtpType } from "./otp-codes.service";

const SIGN_IN_PATH = "/sign-in/email-otp";

// New accounts through a code follow the password-registration switch.
function signUpDisabled(): boolean {
  return process.env.DISABLE_PASSWORD_REGISTRATION === "true";
}

export type EmailOtpSignIn = {
  email: string;
  otp: string;
  name?: string;
  image?: string;
  locale?: string | null;
};

@Injectable()
export class EmailOtpService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly codes: OtpCodes,
    private readonly registration: UserRegistrationService,
    private readonly eligibility: SessionEligibilityService,
    private readonly current: CurrentSessionService,
    private readonly emails: EmailService,
    private readonly deliveries: BackgroundEmailDeliveries,
  ) {}

  /**
   * Issues a code. Only sign-in codes are emailed, after the response, and
   * only to addresses that could use them; the answer never says which.
   */
  async send(
    rawEmail: string,
    type: OtpType | "change-email",
    userAgent?: string,
  ) {
    const email = rawEmail.toLowerCase();
    if (!z.email().safeParse(email).success) throw authError("INVALID_EMAIL");
    if (type === "change-email") {
      throw new HTTPException(400, { message: "Invalid OTP type" });
    }

    const otp = await this.codes.issue(type, email);
    const mayCreateAccount = type === "sign-in" && !signUpDisabled();
    const manager = this.dataSource.manager;
    const exists = await manager.exists(UserEntity, { where: { email } });
    if (!exists && !mayCreateAccount) {
      await this.codes.discard(type, email);
      return { success: true };
    }

    if (type === "sign-in") {
      const context = getEmailRequestContext(userAgent);
      this.deliveries.queue(async () => {
        if (!(await shouldDeliverSignInEmail(manager, email))) return;
        const locale = await getUserLocale(manager, email);
        await this.emails.sendOtpEmail(
          email,
          getAuthEmailCopy(locale).otpSubject(otp),
          { otp, locale, ...context },
        );
      }, "Sign-in email delivery failed");
    }
    return { success: true };
  }

  /** Redeems a sign-in code; an unknown address gets an account, if allowed. */
  async signIn(input: EmailOtpSignIn, request: Request, response: Response) {
    const email = input.email.toLowerCase();
    await this.codes.redeem("sign-in", email, input.otp);

    const manager = this.dataSource.manager;
    let user = await manager.findOne(UserEntity, { where: { email } });
    if (!user) {
      if (signUpDisabled()) throw authError("INVALID_OTP");
      user = await this.registration.create(
        {
          email,
          emailVerified: true,
          name: input.name || "",
          image: input.image,
          locale: input.locale,
        },
        { path: SIGN_IN_PATH, invitationId: requestInvitationId(request) },
      );
    } else {
      user = await this.eligibility.proveEmailOwnership(user);
    }
    user = await this.eligibility.assertNotBanned(user);

    const issued = await this.current.start(user, request, response);
    return { token: issued.accessToken, user: userOutput(issued.user) };
  }
}
