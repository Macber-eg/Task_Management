import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { resolveAuthSecret } from "../config/auth-secret";
import { ApiKeyAuthenticator } from "./api-key/api-key-authenticator";
import { Authenticator } from "./authenticator";
import { parseBearerToken } from "./bearer-token";
import { readAccessCookie } from "./cookies/auth-cookies";
import { readLegacySessionCookie } from "./legacy-session-token";
import type { Principal } from "./principal";
import { type LiveSession, SessionService } from "./sessions/session.service";
import {
  AccessTokenService,
  looksLikeJwt,
} from "./tokens/access-token.service";

function toPrincipal(live: LiveSession): Principal {
  return {
    userId: live.user.id,
    userEmail: live.user.email ?? "",
    user: live.user,
    session: live.session,
  };
}

/**
 * Resolves the caller from, in order: an `x-api-key` header; a Bearer token
 * (access token, API key, or an opaque CLI/MCP/legacy session token); the
 * access-token cookie; and finally the previous backend's session cookie.
 * An explicit credential that fails is never rescued by a cookie.
 */
@Injectable()
export class RequestAuthenticator extends Authenticator {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeyAuthenticator,
  ) {
    super();
  }

  async authenticate(request: Request): Promise<Principal | null> {
    const { token, malformed } = parseBearerToken(request.get("authorization"));
    if (malformed) return null;

    const apiKeyHeader = request.get("x-api-key")?.trim();
    if (!token && apiKeyHeader) {
      return this.apiKeys.authenticate(apiKeyHeader, { consume: true }, request);
    }

    if (token) {
      if (looksLikeJwt(token)) return this.fromAccessToken(token);
      const apiKeyPrincipal = await this.apiKeys.authenticate(
        token,
        { consume: true },
        request,
      );
      if (apiKeyPrincipal) return apiKeyPrincipal;
      const live = await this.sessions.findByOpaqueToken(token);
      return live ? toPrincipal(live) : null;
    }

    const accessCookie = readAccessCookie(request);
    if (accessCookie) {
      const principal = await this.fromAccessToken(accessCookie);
      if (principal) return principal;
    }

    // A browser still holding only the previous backend's cookie keeps
    // working; GET /auth/get-session upgrades it to the new tokens.
    const legacyToken = readLegacySessionCookie(request, resolveAuthSecret());
    if (legacyToken) {
      const live = await this.sessions.findByOpaqueToken(legacyToken);
      return live ? toPrincipal(live) : null;
    }

    return null;
  }

  private async fromAccessToken(token: string): Promise<Principal | null> {
    const claims = await this.accessTokens.verify(token);
    if (!claims) return null;
    // The token alone is not enough: the session row must still exist, so
    // sign-out, bans and password resets take effect at once.
    const live = await this.sessions.findLive(claims.sid);
    if (!live || live.user.id !== claims.sub) return null;
    return toPrincipal(live);
  }
}
