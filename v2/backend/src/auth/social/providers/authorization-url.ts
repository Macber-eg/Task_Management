import { calculatePKCECodeChallenge } from "openid-client";

export type AuthorizationURLOptions = {
  authorizationEndpoint: string;
  clientId: string;
  state: string;
  redirectURI: string;
  scopes?: string[];
  /** Adds an S256 PKCE challenge when given. */
  codeVerifier?: string;
  responseType?: string;
  loginHint?: string;
  prompt?: string;
  additionalParams?: Record<string, string>;
};

/** A provider's authorization URL, with parameters in the usual order. */
export async function buildAuthorizationURL(
  options: AuthorizationURLOptions,
): Promise<URL> {
  const url = new URL(options.authorizationEndpoint);
  url.searchParams.set("response_type", options.responseType || "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("state", options.state);
  if (options.scopes) url.searchParams.set("scope", options.scopes.join(" "));
  url.searchParams.set("redirect_uri", options.redirectURI);
  if (options.loginHint) url.searchParams.set("login_hint", options.loginHint);
  if (options.prompt) url.searchParams.set("prompt", options.prompt);
  if (options.codeVerifier) {
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set(
      "code_challenge",
      await calculatePKCECodeChallenge(options.codeVerifier),
    );
  }
  for (const [key, value] of Object.entries(options.additionalParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}
