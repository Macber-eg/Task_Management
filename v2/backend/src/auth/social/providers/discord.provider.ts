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

function credentials() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID || "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  };
}

function avatarUrl(profile: Record<string, unknown>): string {
  const id = String(profile.id);
  const avatar = profile.avatar;
  if (typeof avatar === "string") {
    const format = avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${format}`;
  }
  const index =
    profile.discriminator === "0"
      ? Number(BigInt(id) >> BigInt(22)) % 6
      : Number.parseInt(String(profile.discriminator), 10) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export class DiscordProvider implements OAuthProvider {
  readonly id = "discord";

  constructor(private readonly endpoints: SocialProviderEndpoints["discord"]) {}

  // Built by hand, as Discord's provider always did: no PKCE, and scopes
  // joined with `+`.
  async createAuthorizationURL(request: AuthorizationRequest): Promise<URL> {
    const scopes = ["identify", "email", ...(request.scopes ?? [])];
    return new URL(
      `${this.endpoints.authorize}?scope=${scopes.join("+")}&response_type=code&client_id=${credentials().clientId}&redirect_uri=${encodeURIComponent(request.redirectURI)}&state=${request.state}&prompt=none`,
    );
  }

  async validateAuthorizationCode(exchange: CodeExchange): Promise<OAuthTokens> {
    const { data, status } = await postTokenRequest(
      this.endpoints.token,
      { code: exchange.code, redirectURI: exchange.redirectURI, ...credentials() },
      { refuseRedirects: true },
    );
    if (!isSuccess(status) || !data) {
      throw new Error(`Discord token exchange failed (${status})`);
    }
    return parseTokenResponse(data);
  }

  async getUserInfo(tokens: OAuthTokens): Promise<{ user: ProviderUser } | null> {
    const profile = await getProviderJson(this.endpoints.user, {
      authorization: `Bearer ${tokens.accessToken}`,
    });
    if (!profile || Array.isArray(profile)) return null;
    return {
      user: {
        id: profile.id as string,
        name:
          (typeof profile.global_name === "string" && profile.global_name) ||
          (typeof profile.username === "string" && profile.username) ||
          "",
        email: profile.email as string | undefined,
        emailVerified: profile.verified as boolean | undefined,
        image: avatarUrl(profile),
      },
    };
  }
}
