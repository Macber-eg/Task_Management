import { Injectable } from "@nestjs/common";
import { parseBearerToken } from "../../auth/bearer-token";
import { SessionService } from "../../auth/sessions/session.service";
import {
  AccessTokenService,
  looksLikeJwt,
} from "../../auth/tokens/access-token.service";

export type McpCaller = { userId: string; token: string };

/**
 * The MCP endpoint accepts login sessions only: the opaque token the OAuth
 * flow (or device flow) issued, or a browser access token. API keys are not
 * sessions and are refused, as before. A banned user's sessions are not
 * usable, so their tokens stop working at once.
 */
@Injectable()
export class McpBearerAuthenticator {
  constructor(
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async authenticate(authorization: string | undefined): Promise<McpCaller | null> {
    const { token } = parseBearerToken(authorization);
    if (!token) return null;

    if (looksLikeJwt(token)) {
      const claims = await this.accessTokens.verify(token);
      const live = claims ? await this.sessions.findLive(claims.sid) : null;
      return live && live.user.id === claims?.sub
        ? { userId: live.user.id, token }
        : null;
    }

    const live = await this.sessions.findByOpaqueToken(token);
    return live ? { userId: live.user.id, token } : null;
  }
}
