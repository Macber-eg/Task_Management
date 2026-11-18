import { Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import type { UserEntity } from "../../database/entities/user.entity";
import { CurrentSessionService } from "../sessions/current-session.service";
import { SessionEligibilityService } from "../sign-in-policy/session-eligibility.service";

/**
 * Signs a user in at the end of an OAuth callback: refuses a banned user and
 * lifts a ban that has run out. Starting the session also records the
 * provider in the last-login-method cookie (the callback path names it).
 */
@Injectable()
export class OAuthSessionStarter {
  constructor(
    private readonly eligibility: SessionEligibilityService,
    private readonly sessions: CurrentSessionService,
  ) {}

  async start(
    user: UserEntity,
    request: Request,
    response: Response,
  ): Promise<void> {
    const eligible = await this.eligibility.assertNotBanned(user);
    await this.sessions.start(eligible, request, response);
  }
}
