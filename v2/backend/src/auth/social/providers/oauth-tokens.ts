import type { OAuthTokens } from "./oauth-provider";

type TokenResponse = Record<string, unknown>;

function secondsFromNow(value: unknown): Date | undefined {
  const seconds = Number(value);
  return value && Number.isFinite(seconds)
    ? new Date(Date.now() + seconds * 1000)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reads an OAuth 2.0 token endpoint response. */
export function parseTokenResponse(data: TokenResponse): OAuthTokens {
  const scope = data.scope;
  return {
    tokenType: text(data.token_type),
    accessToken: text(data.access_token),
    refreshToken: text(data.refresh_token),
    accessTokenExpiresAt: secondsFromNow(data.expires_in),
    refreshTokenExpiresAt: secondsFromNow(data.refresh_token_expires_in),
    scopes:
      typeof scope === "string" && scope
        ? scope.split(" ")
        : Array.isArray(scope)
          ? scope.filter((item): item is string => typeof item === "string")
          : [],
    idToken: text(data.id_token),
  };
}
