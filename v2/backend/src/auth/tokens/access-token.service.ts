import { hkdfSync } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { resolveAuthSecret } from "../../config/auth-secret";

const ISSUER = "kaneo-api";
const AUDIENCE = "kaneo";
const DEFAULT_TTL_SECONDS = 300;

export type AccessTokenClaims = {
  /** User id. */
  sub: string;
  /** Session id: the row whose existence keeps this token usable. */
  sid: string;
};

/** A dedicated signing key, so the raw AUTH_SECRET signs nothing directly. */
export function deriveAccessTokenKey(secret = resolveAuthSecret()): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, Buffer.alloc(0), "kaneo-access-jwt-v1", 32),
  );
}

export function accessTokenTtlSeconds(): number {
  const configured = Number(process.env.AUTH_ACCESS_TTL_SECONDS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_TTL_SECONDS;
}

/** Opaque session tokens and API keys are never three dot-separated parts. */
export function looksLikeJwt(token: string): boolean {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

/**
 * Short-lived access tokens. They carry only who and which session; role,
 * ban state and active workspace are read from the database on each request
 * so that revoking a session takes effect immediately.
 */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: deriveAccessTokenKey(),
      algorithm: "HS256",
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: accessTokenTtlSeconds(),
    });
  }

  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<Partial<AccessTokenClaims>>(
        token,
        {
          secret: deriveAccessTokenKey(),
          algorithms: ["HS256"],
          issuer: ISSUER,
          audience: AUDIENCE,
        },
      );
      return typeof payload.sub === "string" && typeof payload.sid === "string"
        ? { sub: payload.sub, sid: payload.sid }
        : null;
    } catch {
      return null;
    }
  }
}
