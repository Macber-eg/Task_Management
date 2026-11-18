import { buildAuthorizationURL } from "./authorization-url";
import { decodeJwtClaims } from "./decode-jwt-claims";
import type {
  AuthorizationRequest,
  CodeExchange,
  OAuthProvider,
  OAuthTokens,
  ProviderUser,
} from "./oauth-provider";
import { parseTokenResponse } from "./oauth-tokens";
import { isSuccess, postTokenRequest } from "./provider-http";
import type { SocialProviderEndpoints } from "./social-provider-endpoints";

const SCOPES = ["email", "profile", "openid"];

function credentials() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  };
}

export class GoogleProvider implements OAuthProvider {
  readonly id = "google";

  constructor(private readonly endpoints: SocialProviderEndpoints["google"]) {}

  createAuthorizationURL(request: AuthorizationRequest): Promise<URL> {
    const { clientId, clientSecret } = credentials();
    if (!clientId || !clientSecret) {
      throw new Error("CLIENT_ID_AND_SECRET_REQUIRED");
    }
    return buildAuthorizationURL({
      authorizationEndpoint: this.endpoints.authorize,
      clientId,
      state: request.state,
      redirectURI: request.redirectURI,
      scopes: [...SCOPES, ...(request.scopes ?? [])],
      codeVerifier: request.codeVerifier,
      loginHint: request.loginHint,
      additionalParams: { include_granted_scopes: "true" },
    });
  }

  async validateAuthorizationCode(exchange: CodeExchange): Promise<OAuthTokens> {
    const { data, status } = await postTokenRequest(
      this.endpoints.token,
      { ...exchange, ...credentials() },
      { refuseRedirects: true },
    );
    if (!isSuccess(status) || !data) {
      throw new Error(`Google token exchange failed (${status})`);
    }
    return parseTokenResponse(data);
  }

  async getUserInfo(tokens: OAuthTokens): Promise<{ user: ProviderUser } | null> {
    if (!tokens.idToken) return null;
    const claims = decodeJwtClaims(tokens.idToken);
    if (!claims) return null;
    return {
      user: {
        id: claims.sub as string,
        name: claims.name as string | undefined,
        email: claims.email as string | undefined,
        image: claims.picture as string | undefined,
        emailVerified: claims.email_verified as boolean | undefined,
      },
    };
  }
}
