import { Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiError } from "../../common/errors/api-error";
import { OAuthStateService } from "../oauth-state/oauth-state.service";
import { authBaseURL, defaultOAuthErrorURL } from "../social/auth-urls";
import { OAuthAccountLinkService } from "../social/oauth-account-link.service";
import { accountData, type OAuthUserInfo } from "../social/oauth-identity";
import { redirectOnError } from "../social/oauth-redirect";
import { OAuthSessionStarter } from "../social/oauth-session-starter.service";
import { OAuthSignInService } from "../social/oauth-sign-in.service";
import type { OAuthTokens } from "../social/providers/oauth-provider";
import { mapCustomOAuthProfileToUser } from "./custom-oauth-profile";
import { resolveCustomOAuthEndpoints } from "./custom-oauth-endpoints";
import { exchangeGenericCode } from "./exchange-generic-code";
import { fetchGenericProfile, isNonEmptyId } from "./generic-user-info";
import { requireCustomOAuthConfig } from "./require-custom-oauth-config";

export type OAuth2CallbackQuery = {
  code?: string;
  error?: string;
  error_description?: string;
  state?: string;
  iss?: string;
};

/**
 * `GET /oauth2/callback/:providerId`: the generic provider sends the browser
 * back here. Ends in a redirect, like the social callback.
 */
@Injectable()
export class OidcCallbackService {
  private readonly logger = new Logger(OidcCallbackService.name);

  constructor(
    private readonly state: OAuthStateService,
    private readonly signIns: OAuthSignInService,
    private readonly links: OAuthAccountLinkService,
    private readonly sessions: OAuthSessionStarter,
  ) {}

  /** Returns where to send the browser; failures throw `OAuthRedirect`. */
  async handle(
    providerId: string,
    query: OAuth2CallbackQuery,
    request: Request,
    response: Response,
  ): Promise<string> {
    if (query.error || !query.code) {
      redirectOnError(
        defaultOAuthErrorURL(),
        query.error || "oAuth_code_missing",
        query.error_description || undefined,
      );
    }
    const config = requireCustomOAuthConfig(providerId);
    const flow = await this.state.consume(request, response, query.state);
    const { errorURL } = flow;

    const endpoints = await resolveCustomOAuthEndpoints(config);
    // RFC 9207: an `iss` naming another server means the response is not
    // from the provider this flow started with.
    if (endpoints.issuer && query.iss && query.iss !== endpoints.issuer) {
      redirectOnError(errorURL, "issuer_mismatch");
    }

    let tokens: OAuthTokens | undefined;
    try {
      if (!endpoints.tokenUrl) throw new Error("Invalid OAuth configuration.");
      tokens = await exchangeGenericCode(endpoints.tokenUrl, config, {
        code: query.code,
        codeVerifier: config.pkce ? flow.codeVerifier : undefined,
        redirectURI: `${authBaseURL()}/oauth2/callback/${config.providerId}`,
      });
    } catch (error) {
      this.logger.error("OAuth code verification failed", error);
      return redirectOnError(errorURL, "oauth_code_verification_failed");
    }

    const userInfo = await this.userInfo(tokens, endpoints.userInfoUrl, errorURL);
    const account = accountData(config.providerId, userInfo.id, tokens);

    if (flow.link) {
      await this.links.link(flow.link.userId, account, errorURL);
      return flow.callbackURL;
    }

    const result = await this.signIns.signIn(userInfo, account, {
      path: `/oauth2/callback/${providerId}`,
      invitationId: request.get("x-invitation-id"),
    });
    if (result.error !== undefined) {
      return redirectOnError(errorURL, result.error.split(" ").join("_"));
    }

    try {
      await this.sessions.start(result.user, request, response);
    } catch (error) {
      if (error instanceof ApiError) {
        redirectOnError(errorURL, error.code, error.message);
      }
      throw error;
    }
    return result.isRegister
      ? flow.newUserURL || flow.callbackURL
      : flow.callbackURL;
  }

  private async userInfo(
    tokens: OAuthTokens,
    userInfoUrl: string | undefined,
    errorURL: string,
  ): Promise<OAuthUserInfo> {
    const profile = await fetchGenericProfile(tokens, userInfoUrl);
    if (!profile) return redirectOnError(errorURL, "user_info_is_missing");
    const mapped = mapCustomOAuthProfileToUser(profile);

    const email =
      typeof profile.email === "string" ? profile.email.toLowerCase() : "";
    if (!email) return redirectOnError(errorURL, "email_is_missing");

    const rawId = isNonEmptyId(profile.id)
      ? profile.id
      : isNonEmptyId(profile.sub)
        ? profile.sub
        : undefined;
    const id = rawId !== undefined ? String(rawId) : "";
    if (!id) return redirectOnError(errorURL, "id_is_missing");

    const name =
      mapped.name || (typeof profile.name === "string" ? profile.name : "");
    if (!name) return redirectOnError(errorURL, "name_is_missing");

    return { ...profile, ...mapped, email, id, name };
  }
}
