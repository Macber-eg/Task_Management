import type { OAuthTokens } from "../social/providers/oauth-provider";
import { parseTokenResponse } from "../social/providers/oauth-tokens";
import { isSuccess, postTokenRequest } from "../social/providers/provider-http";
import type { CustomOAuthConfig } from "./custom-oauth-config";

/** The generic provider's authorization-code grant; throws when refused. */
export async function exchangeGenericCode(
  tokenUrl: string,
  config: CustomOAuthConfig,
  exchange: { code: string; codeVerifier?: string; redirectURI: string },
): Promise<OAuthTokens> {
  const { data, status } = await postTokenRequest(
    tokenUrl,
    {
      ...exchange,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
    { refuseRedirects: true },
  );
  if (!isSuccess(status) || !data) {
    throw new Error(`Token endpoint answered ${status}`);
  }
  return parseTokenResponse(data);
}
