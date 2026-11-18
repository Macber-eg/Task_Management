import { Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../../common/errors/api-error";
import { OAuthStateService } from "../oauth-state/oauth-state.service";
import { authBaseURL, defaultOAuthErrorURL } from "./auth-urls";
import { OAuthAccountLinkService } from "./oauth-account-link.service";
import { accountData, isVerified } from "./oauth-identity";
import { redirectOnError } from "./oauth-redirect";
import { OAuthSessionStarter } from "./oauth-session-starter.service";
import { OAuthSignInService } from "./oauth-sign-in.service";
import type { OAuthTokens } from "./providers/oauth-provider";
import { SocialProviders } from "./social-providers";

export const socialCallbackQuerySchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
  device_id: z.string().optional(),
  error_description: z.string().optional(),
  state: z.string().optional(),
  user: z.string().optional(),
});

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * `GET /callback/:id`: the provider sends the browser back here. Ends in a
 * redirect to the web app on success (the new-user page for a first sign-in)
 * and to the flow's error page, with an `error` code, on any failure.
 */
@Injectable()
export class SocialCallbackService {
  private readonly logger = new Logger(SocialCallbackService.name);

  constructor(
    private readonly providers: SocialProviders,
    private readonly state: OAuthStateService,
    private readonly signIns: OAuthSignInService,
    private readonly links: OAuthAccountLinkService,
    private readonly sessions: OAuthSessionStarter,
  ) {}

  /** Returns where to send the browser; failures throw `OAuthRedirect`. */
  async handle(
    providerId: string,
    rawQuery: unknown,
    request: Request,
    response: Response,
  ): Promise<string> {
    const parsed = socialCallbackQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return redirectOnError(defaultOAuthErrorURL(), "invalid_callback_request");
    }
    const query = parsed.data;
    const flow = await this.state.consume(request, response, query.state);
    const { errorURL } = flow;

    if (query.error) {
      redirectOnError(errorURL, query.error, query.error_description);
    }
    if (!query.code) redirectOnError(errorURL, "no_code");
    const provider = this.providers.find(providerId);
    if (!provider) return redirectOnError(errorURL, "oauth_provider_not_found");

    let tokens: OAuthTokens | null = null;
    try {
      tokens = await provider.validateAuthorizationCode({
        code: query.code,
        codeVerifier: flow.codeVerifier,
        deviceId: query.device_id,
        redirectURI: `${authBaseURL()}/callback/${provider.id}`,
      });
    } catch (error) {
      this.logger.error("OAuth code exchange failed", error);
    }
    if (!tokens) return redirectOnError(errorURL, "invalid_code");

    const userInfo = (
      await provider.getUserInfo({ ...tokens, user: parseJson(query.user) })
    )?.user;
    if (
      !userInfo ||
      userInfo.id === undefined ||
      userInfo.id === null ||
      userInfo.id === ""
    ) {
      return redirectOnError(errorURL, "unable_to_get_user_info");
    }
    const accountId = String(userInfo.id);
    const account = accountData(provider.id, accountId, tokens);

    if (flow.link) {
      // Linking needs the provider to vouch for the email it reports.
      if (!isVerified(userInfo.emailVerified)) {
        redirectOnError(errorURL, "unable_to_link_account");
      }
      await this.links.link(flow.link.userId, account, errorURL);
      return flow.callbackURL;
    }

    if (!userInfo.email) return redirectOnError(errorURL, "email_not_found");

    const result = await this.signIns.signIn(
      { ...userInfo, id: accountId, email: userInfo.email, name: userInfo.name || "" },
      account,
      {
        path: `/callback/${providerId}`,
        invitationId: request.get("x-invitation-id"),
      },
    );
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
}
