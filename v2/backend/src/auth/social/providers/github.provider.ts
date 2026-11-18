import { Logger } from "@nestjs/common";
import { getGithubSsoOAuthCredentials } from "../../../config/github-sso-env";
import { buildAuthorizationURL } from "./authorization-url";
import type {
  AuthorizationRequest,
  CodeExchange,
  OAuthProvider,
  OAuthTokens,
  ProviderUser,
} from "./oauth-provider";
import { parseTokenResponse } from "./oauth-tokens";
import { getProviderJson, isSuccess, postTokenRequest } from "./provider-http";
import type { SocialProviderEndpoints } from "./social-provider-endpoints";

// Kaneo's configured scope is appended to the provider's defaults, so
// `user:email` is requested twice, as it always was.
const SCOPES = ["read:user", "user:email", "user:email"];
const USER_AGENT = "better-auth";

type GithubEmail = { email?: string; primary?: boolean; verified?: boolean };

export class GithubProvider implements OAuthProvider {
  readonly id = "github";
  private readonly logger = new Logger(GithubProvider.name);

  constructor(private readonly endpoints: SocialProviderEndpoints["github"]) {}

  createAuthorizationURL(request: AuthorizationRequest): Promise<URL> {
    return buildAuthorizationURL({
      authorizationEndpoint: this.endpoints.authorize,
      clientId: getGithubSsoOAuthCredentials().clientId,
      state: request.state,
      redirectURI: request.redirectURI,
      scopes: [...SCOPES, ...(request.scopes ?? [])],
      codeVerifier: request.codeVerifier,
      loginHint: request.loginHint,
    });
  }

  async validateAuthorizationCode(
    exchange: CodeExchange,
  ): Promise<OAuthTokens | null> {
    const { clientId, clientSecret } = getGithubSsoOAuthCredentials();
    const { data, status } = await postTokenRequest(
      this.endpoints.token,
      { ...exchange, clientId, clientSecret },
      { refuseRedirects: false },
    );
    if (!isSuccess(status) || !data || "error" in data) {
      this.logger.error("GitHub OAuth token exchange failed");
      return null;
    }
    return parseTokenResponse(data);
  }

  async getUserInfo(tokens: OAuthTokens): Promise<{ user: ProviderUser } | null> {
    const headers = {
      "User-Agent": USER_AGENT,
      authorization: `Bearer ${tokens.accessToken}`,
    };
    const profile = await getProviderJson(this.endpoints.user, headers);
    if (!profile || Array.isArray(profile)) return null;
    const emails = await getProviderJson(this.endpoints.emails, headers);
    const emailList = Array.isArray(emails) ? (emails as GithubEmail[]) : null;

    let email = typeof profile.email === "string" ? profile.email : null;
    if (!email && emailList) {
      email = (emailList.find((entry) => entry.primary) ?? emailList[0])?.email ?? null;
    }
    const emailVerified =
      emailList?.find((entry) => entry.email === email)?.verified ?? false;

    return {
      user: {
        id: profile.id as string | number,
        name:
          (typeof profile.name === "string" && profile.name) ||
          (typeof profile.login === "string" && profile.login) ||
          "",
        email,
        image: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
        emailVerified,
      },
    };
  }
}
