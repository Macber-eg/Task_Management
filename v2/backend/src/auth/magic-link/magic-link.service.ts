import { Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { DataSource } from "typeorm";
import { reply } from "../../common/http/reply";
import { UserEntity } from "../../database/entities/user.entity";
import { getAuthEmailCopy } from "../../email/auth-email-copy";
import { BackgroundEmailDeliveries } from "../../email/background-email-deliveries";
import { EmailService } from "../../email/email.service";
import { getEmailRequestContext } from "../../email/email-request-context";
import { getUserLocale } from "../../email/get-user-locale";
import { LETTERS, randomString } from "../api-key/random-string";
import { CurrentSessionService } from "../sessions/current-session.service";
import { sessionOutput, userOutput } from "../sessions/session-output";
import { requestInvitationId } from "../sign-in-policy/request-invitation-id";
import { SessionEligibilityService } from "../sign-in-policy/session-eligibility.service";
import { shouldDeliverSignInEmail } from "../sign-in-policy/should-deliver-sign-in-email";
import { UserRegistrationService } from "../sign-in-policy/user-registration.service";
import { authBaseURL } from "../social/auth-urls";
import { VerificationStore } from "../verification/verification-store.service";
import { decodeUrlParameter } from "./decode-url-parameter";

const VERIFY_PATH = "/magic-link/verify";
const TOKEN_TTL_MS = 5 * 60 * 1000;

export type MagicLinkRequest = {
  email: string;
  name?: string;
  callbackURL?: string;
  newUserCallbackURL?: string;
  errorCallbackURL?: string;
};

export type MagicLinkVerification = {
  token: string;
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
};

// New accounts through a link follow the password-registration switch.
function signUpDisabled(): boolean {
  return process.env.DISABLE_PASSWORD_REGISTRATION === "true";
}

@Injectable()
export class MagicLinkService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly verifications: VerificationStore,
    private readonly registration: UserRegistrationService,
    private readonly eligibility: SessionEligibilityService,
    private readonly current: CurrentSessionService,
    private readonly emails: EmailService,
    private readonly deliveries: BackgroundEmailDeliveries,
  ) {}

  /** Stores a five-minute link and emails it after the response, if useful. */
  async send(input: MagicLinkRequest, userAgent?: string) {
    const token = randomString(32, LETTERS);
    await this.verifications.create(
      token,
      JSON.stringify({ email: input.email, name: input.name }),
      new Date(Date.now() + TOKEN_TTL_MS),
    );

    const url = new URL(`${authBaseURL()}${VERIFY_PATH}`);
    url.searchParams.set("token", token);
    url.searchParams.set("callbackURL", input.callbackURL || "/");
    if (input.newUserCallbackURL) {
      url.searchParams.set("newUserCallbackURL", input.newUserCallbackURL);
    }
    if (input.errorCallbackURL) {
      url.searchParams.set("errorCallbackURL", input.errorCallbackURL);
    }

    const email = input.email;
    const context = getEmailRequestContext(userAgent);
    const manager = this.dataSource.manager;
    this.deliveries.queue(async () => {
      if (!(await shouldDeliverSignInEmail(manager, email))) return;
      const locale = await getUserLocale(manager, email);
      await this.emails.sendMagicLinkEmail(
        email,
        getAuthEmailCopy(locale).magicLinkSubject,
        { magicLink: url.toString(), locale, ...context },
      );
    }, "Sign-in email delivery failed");

    return { status: true };
  }

  /**
   * Redeems a link once. Without a callback URL it answers with the session;
   * otherwise it redirects, with `?error=` on failure.
   */
  async verify(
    query: MagicLinkVerification,
    request: Request,
    response: Response,
  ) {
    const base = authBaseURL();
    const callbackURL = new URL(
      query.callbackURL ? decodeUrlParameter(query.callbackURL) : "/",
      base,
    ).toString();
    const errorCallbackURL = new URL(
      query.errorCallbackURL ? decodeUrlParameter(query.errorCallbackURL) : callbackURL,
      base,
    );
    const newUserCallbackURL = new URL(
      query.newUserCallbackURL
        ? decodeUrlParameter(query.newUserCallbackURL)
        : callbackURL,
      base,
    ).toString();
    const redirectWithError = (error: string) => {
      errorCallbackURL.searchParams.set("error", error);
      return reply(302, undefined, { Location: errorCallbackURL.toString() });
    };

    const consumed = await this.verifications.consume(query.token);
    if (!consumed) return redirectWithError("INVALID_TOKEN");
    const { email, name } = JSON.parse(consumed.value) as {
      email: string;
      name?: string;
    };

    const manager = this.dataSource.manager;
    let isNewUser = false;
    let user = await manager.findOne(UserEntity, {
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      if (signUpDisabled()) return redirectWithError("new_user_signup_disabled");
      user = await this.registration.create(
        { email, emailVerified: true, name: name || "" },
        { path: VERIFY_PATH, invitationId: requestInvitationId(request) },
      );
      isNewUser = true;
    }
    user = await this.eligibility.proveEmailOwnership(user);
    user = await this.eligibility.assertNotBanned(user);

    const issued = await this.current.start(user, request, response);
    if (!query.callbackURL) {
      return {
        token: issued.accessToken,
        user: userOutput(issued.user),
        session: sessionOutput(issued.session, issued.accessToken),
      };
    }
    return reply(302, undefined, {
      Location: isNewUser ? newUserCallbackURL : callbackURL,
    });
  }
}
