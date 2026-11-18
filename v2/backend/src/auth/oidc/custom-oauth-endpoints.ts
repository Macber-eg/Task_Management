import type { CustomOAuthConfig } from "./custom-oauth-config";
import { discoverEndpoints } from "./oidc-discovery";

export type CustomOAuthEndpoints = {
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  issuer?: string;
};

/**
 * The generic provider's endpoints: the discovery document's when it can be
 * read (it overrides the manual URLs), else the manually configured ones.
 */
export async function resolveCustomOAuthEndpoints(
  config: CustomOAuthConfig,
): Promise<CustomOAuthEndpoints> {
  const manual = {
    authorizationUrl: config.authorizationUrl,
    tokenUrl: config.tokenUrl,
    userInfoUrl: config.userInfoUrl,
  };
  if (!config.discoveryUrl) return manual;
  const discovered = await discoverEndpoints(config.discoveryUrl, config.clientId);
  if (!discovered) return manual;
  return {
    authorizationUrl: discovered.authorization_endpoint,
    tokenUrl: discovered.token_endpoint,
    userInfoUrl: discovered.userinfo_endpoint,
    issuer: discovered.issuer,
  };
}
