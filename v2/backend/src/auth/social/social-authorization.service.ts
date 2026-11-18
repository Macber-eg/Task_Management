import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import type { OAuthStateRequest } from "../oauth-state/oauth-state-data";
import { OAuthStateService } from "../oauth-state/oauth-state.service";
import { authBaseURL } from "./auth-urls";
import { oauthError } from "./oauth-error";
import type { OAuthProvider } from "./providers/oauth-provider";
import { SocialProviders } from "./social-providers";

export type AuthorizationStart = OAuthStateRequest & {
  provider: string;
  idToken?: unknown;
  scopes?: string[];
  loginHint?: string;
};

/**
 * Starts a sign-in or link flow: remembers the request under a fresh state
 * and answers with the provider's authorization URL.
 */
@Injectable()
export class SocialAuthorizationService {
  constructor(
    private readonly providers: SocialProviders,
    private readonly state: OAuthStateService,
  ) {}

  async start(
    request: AuthorizationStart,
    response: Response,
    link?: { userId: string; email: string },
  ): Promise<URL> {
    const provider = this.provider(request);
    const { state, codeVerifier } = await this.state.generate(
      request,
      response,
      link,
    );
    return provider.createAuthorizationURL({
      state,
      codeVerifier,
      redirectURI: `${authBaseURL()}/callback/${provider.id}`,
      scopes: request.scopes,
      loginHint: request.loginHint,
    });
  }

  private provider(request: AuthorizationStart): OAuthProvider {
    const provider = this.providers.find(request.provider);
    if (!provider) throw oauthError("PROVIDER_NOT_FOUND");
    // Signing in with a provider-issued ID token (Google One Tap) was never
    // used by Kaneo's clients and is not offered.
    if (request.idToken) throw oauthError("ID_TOKEN_NOT_SUPPORTED");
    return provider;
  }
}
