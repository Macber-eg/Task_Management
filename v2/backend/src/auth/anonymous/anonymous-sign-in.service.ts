import { Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { ALPHANUMERIC, randomString } from "../api-key/random-string";
import { authError } from "../auth-error";
import { CurrentSessionService } from "../sessions/current-session.service";
import { userOutput } from "../sessions/session-output";
import { requestInvitationId } from "../sign-in-policy/request-invitation-id";
import { UserRegistrationService } from "../sign-in-policy/user-registration.service";
import { generateDemoName } from "./generate-demo-name";

const SIGN_IN_PATH = "/sign-in/anonymous";
const GUEST_EMAIL_DOMAIN = "kaneo.app";

/**
 * Guest access: a throwaway account with a generated name. The guest
 * registration rules (instance set up, guests and local sign-in allowed)
 * already ran in the before-hooks guard and run again at account creation.
 */
@Injectable()
export class AnonymousSignInService {
  constructor(
    private readonly registration: UserRegistrationService,
    private readonly current: CurrentSessionService,
  ) {}

  async signIn(request: Request, response: Response) {
    const existing = await this.current.findCurrent(request);
    if (existing?.user.isAnonymous) {
      throw authError("ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY");
    }

    const user = await this.registration.create(
      {
        email: `temp-${randomString(32, ALPHANUMERIC)}@${GUEST_EMAIL_DOMAIN}`,
        emailVerified: false,
        isAnonymous: true,
        name: generateDemoName(),
      },
      { path: SIGN_IN_PATH, invitationId: requestInvitationId(request) },
    );

    const issued = await this.current.start(user, request, response);
    return { token: issued.accessToken, user: userOutput(issued.user) };
  }
}
