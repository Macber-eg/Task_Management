import { resolveFileSecret } from "../../config/file-secret";

export const CUSTOM_PROVIDER_ID = "custom";

export type CustomOAuthConfig = {
  providerId: typeof CUSTOM_PROVIDER_ID;
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  discoveryUrl: string;
  scopes: string[];
  responseType: string;
  pkce: boolean;
};

/** The generic OIDC/OAuth2 provider, read from the environment per call. */
export function customOAuthConfig(): CustomOAuthConfig {
  return {
    providerId: CUSTOM_PROVIDER_ID,
    clientId: process.env.CUSTOM_OAUTH_CLIENT_ID || "",
    clientSecret: resolveFileSecret("CUSTOM_OAUTH_CLIENT_SECRET"),
    authorizationUrl: process.env.CUSTOM_OAUTH_AUTHORIZATION_URL || "",
    tokenUrl: process.env.CUSTOM_OAUTH_TOKEN_URL || "",
    userInfoUrl: process.env.CUSTOM_OAUTH_USER_INFO_URL || "",
    discoveryUrl: process.env.CUSTOM_OAUTH_DISCOVERY_URL || "",
    scopes: process.env.CUSTOM_OAUTH_SCOPES?.split(",")
      .map((scope) => scope.trim())
      .filter(Boolean) || ["profile", "email"],
    responseType: process.env.CUSTOM_OAUTH_RESPONSE_TYPE || "code",
    pkce: process.env.CUSTOM_AUTH_PKCE !== "false",
  };
}
