import { authBaseURL } from "../social/auth-urls";
import { oauthError } from "../social/oauth-error";
import { buildAuthorizationURL } from "../social/providers/authorization-url";
import type {
  AuthorizationRequest,
  CodeExchange,
  OAuthProvider,
  OAuthTokens,
  ProviderUser,
} from "../social/providers/oauth-provider";
import { customOAuthConfig } from "./custom-oauth-config";
import { mapCustomOAuthProfileToUser } from "./custom-oauth-profile";
import { exchangeGenericCode } from "./exchange-generic-code";
import { fetchGenericProfile, isNonEmptyId } from "./generic-user-info";
import { discoverEndpoints } from "./oidc-discovery";

/**
 * The generic provider as the social routes (`/sign-in/social`,
 * `/callback/custom`, `/link-social`) see it. Its authorization URL always
 * sends the browser back to `/oauth2/callback/custom`, whichever route
 * started the flow.
 */
export class CustomOAuthProvider implements OAuthProvider {
  readonly id = "custom";
  private userInfoUrl: string | undefined;

  async createAuthorizationURL(request: AuthorizationRequest): Promise<URL> {
    const config = customOAuthConfig();
    this.userInfoUrl = config.userInfoUrl;
    let authorizationUrl = config.authorizationUrl;
    if (!authorizationUrl && config.discoveryUrl) {
      const discovered = await discoverEndpoints(
        config.discoveryUrl,
        config.clientId,
      );
      authorizationUrl = discovered?.authorization_endpoint ?? "";
    }
    if (!authorizationUrl) throw oauthError("INVALID_OAUTH_CONFIGURATION");
    return buildAuthorizationURL({
      authorizationEndpoint: authorizationUrl,
      clientId: config.clientId,
      state: request.state,
      redirectURI: `${authBaseURL()}/oauth2/callback/${config.providerId}`,
      scopes: config.scopes,
      codeVerifier: config.pkce ? request.codeVerifier : undefined,
    });
  }

  async validateAuthorizationCode(exchange: CodeExchange): Promise<OAuthTokens> {
    const config = customOAuthConfig();
    let tokenUrl = config.tokenUrl;
    this.userInfoUrl = config.userInfoUrl;
    if (config.discoveryUrl) {
      const discovered = await discoverEndpoints(
        config.discoveryUrl,
        config.clientId,
      );
      if (discovered) {
        tokenUrl = discovered.token_endpoint ?? "";
        this.userInfoUrl = discovered.userinfo_endpoint;
      }
    }
    if (!tokenUrl) {
      throw new Error("Invalid OAuth configuration. Token URL not found.");
    }
    return exchangeGenericCode(tokenUrl, config, {
      code: exchange.code,
      codeVerifier: exchange.codeVerifier,
      redirectURI: exchange.redirectURI,
    });
  }

  async getUserInfo(tokens: OAuthTokens): Promise<{ user: ProviderUser } | null> {
    const profile = await fetchGenericProfile(
      tokens,
      this.userInfoUrl ?? customOAuthConfig().userInfoUrl,
    );
    if (!profile) return null;
    const mapped = mapCustomOAuthProfileToUser(profile);
    const rawId = isNonEmptyId(profile.id)
      ? profile.id
      : isNonEmptyId(profile.sub)
        ? profile.sub
        : undefined;
    if (rawId === undefined) return null;
    return {
      user: {
        email: profile.email as string | undefined,
        emailVerified: profile.emailVerified as boolean | undefined,
        image: profile.image as string | undefined,
        name: profile.name as string | undefined,
        ...mapped,
        id: String(rawId),
      },
    };
  }
}
