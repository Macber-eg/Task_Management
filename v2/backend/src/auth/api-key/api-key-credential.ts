import type { Request } from "express";
import { parseBearerToken } from "../bearer-token";
import { looksLikeJwt } from "../tokens/access-token.service";

export type ApiKeyCredential = { key: string; fromBearer: boolean };

/**
 * The value an /auth route treats as a possible API key: `x-api-key` wins
 * over a Bearer token, as it did for the previous backend's auth library.
 * A Bearer token may still turn out to be a session token; an access token
 * (a JWT) never is a key.
 */
export function apiKeyCredential(request: Request): ApiKeyCredential | null {
  const header = request.get("x-api-key")?.trim();
  if (header) return { key: header, fromBearer: false };

  const { token } = parseBearerToken(request.get("authorization"));
  if (!token || looksLikeJwt(token)) return null;
  return { key: token, fromBearer: true };
}
