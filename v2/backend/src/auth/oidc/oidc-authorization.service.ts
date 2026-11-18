import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import type { OAuthStateRequest } from "../oauth-state/oauth-state-data";
import { OAuthStateService } from "../oauth-state/oauth-state.service";
import { authBaseURL } from "../social/auth-urls";
import { oauthError } from "../social/oauth-error";
import { buildAuthorizationURL } from "../social/providers/authorization-url";
import { resolveCustomOAuthEndpoints } from "./custom-oauth-endpoints";
import { requireCustomOAuthConfig } from "./require-custom-oauth-config";

/** `POST /sign-in/oauth2`: starts a sign-in with the generic provider. */
@Injectable()
export class OidcAuthorizationService {
  constructor(private readonly state: OAuthStateService) {}

  async start(
    request: OAuthStateRequest & { providerId: string; scopes?: string[] },
    response: Response,
  ): Promise<URL> {
    const config = requireCustomOAuthConfig(request.providerId);
    const endpoints = await resolveCustomOAuthEndpoints(config);
    if (!endpoints.authorizationUrl || !endpoints.tokenUrl) {
      throw oauthError("INVALID_OAUTH_CONFIGURATION");
    }

    const { state, codeVerifier } = await this.state.generate(request, response);
    return buildAuthorizationURL({
      authorizationEndpoint: endpoints.authorizationUrl,
      clientId: config.clientId,
      state,
      codeVerifier: config.pkce ? codeVerifier : undefined,
      scopes: request.scopes
        ? [...request.scopes, ...config.scopes]
        : config.scopes,
      redirectURI: `${authBaseURL()}/oauth2/callback/${config.providerId}`,
      responseType: config.responseType,
    });
  }
}
