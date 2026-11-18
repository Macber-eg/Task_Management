import { Injectable } from "@nestjs/common";
import { CustomOAuthProvider } from "../oidc/custom-oauth.provider";
import { DiscordProvider } from "./providers/discord.provider";
import { GithubProvider } from "./providers/github.provider";
import { GoogleProvider } from "./providers/google.provider";
import type { OAuthProvider } from "./providers/oauth-provider";
import { SocialProviderEndpoints } from "./providers/social-provider-endpoints";

/**
 * The providers the social routes accept. They are registered whether or not
 * credentials are configured (an unconfigured one fails at the provider), as
 * before; `GET /config` is what tells the web app which ones to offer.
 */
@Injectable()
export class SocialProviders {
  constructor(private readonly endpoints: SocialProviderEndpoints) {}

  /** A fresh instance per flow: the generic provider keeps per-flow state. */
  find(id: string): OAuthProvider | null {
    switch (id) {
      case "custom":
        return new CustomOAuthProvider();
      case "github":
        return new GithubProvider(this.endpoints.github);
      case "google":
        return new GoogleProvider(this.endpoints.google);
      case "discord":
        return new DiscordProvider(this.endpoints.discord);
      default:
        return null;
    }
  }
}
