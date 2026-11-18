import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { hashTokenSecret, newTokenSecret } from "../../auth/tokens/refresh-token";
import { insertReturning } from "../../database/dml";
import { SessionEntity } from "../../database/entities/session.entity";
import { McpOauthFlowState } from "./oauth-flow-state.service";
import { verifyPkce } from "./pkce";

const MCP_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type McpAccessToken = { accessToken: string; expiresIn: number };

/**
 * The token endpoint's grant: a code is spent on its first redemption, even
 * a failed one. The access token is an opaque secret backed by an `mcp`
 * session row that stores only its SHA-256.
 */
@Injectable()
export class McpCodeExchange {
  constructor(
    private readonly dataSource: DataSource,
    private readonly flowState: McpOauthFlowState,
  ) {}

  async exchange(
    code: string,
    clientId: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<McpAccessToken | null> {
    const stored = await this.flowState.consumeAuthCode(code);
    if (!stored) return null;

    if (stored.clientId !== clientId) return null;
    if (stored.redirectUri !== redirectUri) return null;
    if (!verifyPkce(codeVerifier, stored.codeChallenge)) return null;

    const secret = newTokenSecret();
    const now = new Date();
    await insertReturning(this.dataSource.manager, SessionEntity, {
      token: hashTokenSecret(secret),
      userId: stored.userId,
      expiresAt: new Date(now.getTime() + MCP_TOKEN_TTL_SECONDS * 1000),
      createdAt: now,
      updatedAt: now,
      kind: "mcp",
      // Set so the row is never mistaken for an un-upgraded legacy login.
      rotatedAt: now,
    });

    return { accessToken: secret, expiresIn: MCP_TOKEN_TTL_SECONDS };
  }
}
