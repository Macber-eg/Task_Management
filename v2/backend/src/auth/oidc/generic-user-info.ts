import { decodeJwtClaims } from "../social/providers/decode-jwt-claims";
import type { OAuthTokens } from "../social/providers/oauth-provider";
import { getProviderJson } from "../social/providers/provider-http";

export type GenericProfile = Record<string, unknown>;

export function isNonEmptyId(id: unknown): boolean {
  return id !== undefined && id !== null && id !== "";
}

/**
 * The generic provider's view of the user: the ID token's claims when they
 * name a subject and an email, else the userinfo endpoint's answer.
 */
export async function fetchGenericProfile(
  tokens: OAuthTokens,
  userInfoUrl: string | undefined,
): Promise<GenericProfile | null> {
  if (tokens.idToken) {
    const claims = decodeJwtClaims(tokens.idToken);
    if (claims?.sub && claims.email) {
      return {
        id: claims.sub,
        emailVerified: claims.email_verified,
        image: claims.picture,
        ...claims,
      };
    }
  }
  if (!userInfoUrl) return null;

  const profile = await getProviderJson(userInfoUrl, {
    Authorization: `Bearer ${tokens.accessToken}`,
  });
  if (!profile || Array.isArray(profile)) return null;
  const { id: profileId, ...fields } = profile;
  const subject = isNonEmptyId(profileId)
    ? profileId
    : isNonEmptyId(profile.sub)
      ? profile.sub
      : undefined;
  return {
    ...fields,
    ...(subject !== undefined ? { id: subject } : {}),
    email: profile.email,
    emailVerified: profile.email_verified ?? false,
    image: profile.picture,
    name: profile.name,
  };
}
