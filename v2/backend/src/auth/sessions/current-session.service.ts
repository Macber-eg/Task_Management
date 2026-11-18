import { Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { resolveAuthSecret } from "../../config/auth-secret";
import type { UserEntity } from "../../database/entities/user.entity";
import { Authenticator } from "../authenticator";
import { parseBearerToken } from "../bearer-token";
import {
  clearAuthCookies,
  clearLegacySessionCookie,
  readAccessCookie,
  readRefreshCookie,
  setAuthCookies,
} from "../cookies/auth-cookies";
import { GuestAccountLinking } from "../anonymous/guest-account-linking.service";
import {
  resolveLoginMethod,
  setLastLoginMethodCookie,
} from "../last-login-method/last-login-method";
import { readLegacySessionCookie } from "../legacy-session-token";
import { authPath } from "../sign-in-policy/auth-path";
import {
  AccessTokenService,
  accessTokenTtlSeconds,
} from "../tokens/access-token.service";
import { hashTokenSecret, parseRefreshToken, sameHash } from "../tokens/refresh-token";
import { sessionOutput, userOutput } from "./session-output";
import {
  type IssuedSession,
  type LiveSession,
  SessionService,
} from "./session.service";

export type StartOptions = {
  /** `false` keeps the login to this browser session and one day. */
  rememberMe?: boolean;
};

export type CurrentSession = {
  session: ReturnType<typeof sessionOutput>;
  user: ReturnType<typeof userOutput>;
};

/**
 * The browser-facing session lifecycle: answering "who am I", renewing
 * tokens from the refresh cookie, starting a session after sign-in and
 * ending it on sign-out. This is the only place auth cookies are written.
 */
@Injectable()
export class CurrentSessionService {
  constructor(
    private readonly authenticator: Authenticator,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly guestLinking: GuestAccountLinking,
  ) {}

  /**
   * The caller's session, or null. With cookies it also renews: an expired
   * access token is replaced from the refresh cookie, and a login from the
   * previous backend is upgraded, so a page load needs one request.
   */
  async resolve(
    request: Request,
    response: Response,
    options: { allowRefresh: boolean },
  ): Promise<CurrentSession | null> {
    const { token } = parseBearerToken(request.get("authorization"));
    if (request.get("authorization") || request.get("x-api-key")) {
      const principal = await this.authenticator.authenticate(request);
      if (!principal?.session || !principal.user) return null;
      return {
        session: sessionOutput(principal.session, token ?? ""),
        user: userOutput(principal.user),
      };
    }

    const accessCookie = readAccessCookie(request);
    if (accessCookie) {
      const claims = await this.accessTokens.verify(accessCookie);
      const live = claims ? await this.sessions.findLive(claims.sid) : null;
      if (live && live.user.id === claims?.sub) {
        return {
          session: sessionOutput(live.session, accessCookie),
          user: userOutput(live.user),
        };
      }
    }

    if (!options.allowRefresh) return null;
    const renewed = await this.renew(request, response);
    return renewed ? this.output(renewed) : null;
  }

  /** Issues new tokens from the refresh cookie (or a legacy login). */
  async renew(
    request: Request,
    response: Response,
  ): Promise<IssuedSession | null> {
    const refreshCookie = readRefreshCookie(request);
    if (refreshCookie) {
      const issued = await this.sessions.rotate(refreshCookie);
      if (issued) {
        this.writeCookies(response, issued);
        return issued;
      }
    }

    const legacyToken = readLegacySessionCookie(request, resolveAuthSecret());
    if (legacyToken) {
      const issued = await this.sessions.upgradeLegacy(legacyToken);
      if (issued) {
        this.writeCookies(response, issued);
        clearLegacySessionCookie(response);
        return issued;
      }
    }

    return null;
  }

  /**
   * Starts a session for a user who just proved who they are. As in the
   * previous backend, the sign-in route also records the method used (for
   * the web app) and retires a guest account this browser was using.
   */
  async start(
    user: UserEntity,
    request: Request,
    response: Response,
    options: StartOptions = {},
  ): Promise<IssuedSession> {
    const path = authPath(request);
    const previous = this.guestLinking.appliesTo(path)
      ? await this.findCurrent(request)
      : null;

    const issued = await this.sessions.create(user, {
      ipAddress: request.ip ?? null,
      userAgent: request.get("user-agent") ?? null,
      rememberMe: options.rememberMe,
    });
    this.writeCookies(response, issued);
    clearLegacySessionCookie(response);

    const method = resolveLoginMethod(path);
    if (method) setLastLoginMethodCookie(response, method);
    await this.guestLinking.afterSignIn(
      path,
      previous?.user ?? null,
      issued.user,
    );
    return issued;
  }

  /** The login the request's credentials belong to, even past access-token expiry. */
  async findCurrent(request: Request): Promise<LiveSession | null> {
    const sessionId = await this.sessionIdOf(request);
    return sessionId ? this.sessions.findLive(sessionId) : null;
  }

  /** Ends whichever session the request's credentials belong to. */
  async end(request: Request, response: Response): Promise<void> {
    const sessionId = await this.sessionIdOf(request);
    if (sessionId) await this.sessions.revoke(sessionId);
    clearAuthCookies(response);
    clearLegacySessionCookie(response);
  }

  clear(response: Response): void {
    clearAuthCookies(response);
  }

  output(issued: IssuedSession): CurrentSession {
    return {
      session: sessionOutput(issued.session, issued.accessToken),
      user: userOutput(issued.user),
    };
  }

  private writeCookies(response: Response, issued: IssuedSession): void {
    setAuthCookies(response, {
      accessToken: issued.accessToken,
      accessTtlSeconds: accessTokenTtlSeconds(),
      refreshToken: issued.refreshToken ?? undefined,
      // A `rememberMe: false` login's cookie ends with the browser session.
      refreshExpiresAt:
        issued.persistent === false ? undefined : issued.session.expiresAt,
    });
  }

  private async sessionIdOf(request: Request): Promise<string | null> {
    const principal = await this.authenticator
      .authenticate(request)
      .catch(() => null);
    if (principal?.session) return principal.session.id;

    // The access token may have expired; the refresh cookie still proves
    // ownership of the session, but only if its secret matches.
    const refreshCookie = readRefreshCookie(request);
    const parsed = refreshCookie ? parseRefreshToken(refreshCookie) : null;
    if (!parsed) return null;
    const live = await this.sessions.findLive(parsed.sessionId);
    const presented = hashTokenSecret(parsed.secret);
    return live &&
      (sameHash(live.session.token, presented) ||
        sameHash(live.session.previousToken, presented))
      ? live.session.id
      : null;
  }
}
