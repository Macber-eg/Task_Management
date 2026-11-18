import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { Authenticator } from "../authenticator";
import { Public } from "../public.decorator";
import { assertTrustedRedirects } from "../sign-in-policy/assert-trusted-redirects";
import { AuthBeforeHooksGuard } from "../sign-in-policy/auth-before-hooks.guard";
import { authBaseURL } from "./auth-urls";
import { OAuthRedirect } from "./oauth-redirect";
import { requireSignedInUser } from "./require-signed-in-user";
import { SocialAuthorizationService } from "./social-authorization.service";
import { SocialCallbackService } from "./social-callback.service";
import { oauthErrorPage } from "./oauth-error-page";
import {
  linkSocialRoute,
  oauthErrorRoute,
  signInSocialRoute,
  socialCallbackPostRoute,
  socialCallbackRoute,
} from "./social.routes";

function authorizationReply(url: URL, disableRedirect?: boolean) {
  const location = url.toString();
  return reply(
    200,
    { url: location, redirect: !disableRedirect },
    disableRedirect ? {} : { Location: location },
  );
}

/** Public: each route decides for itself what credentials it needs. */
@Public()
// Sign-in initiation is subject to the shared pre-sign-in checks (CAPTCHA).
@UseGuards(AuthBeforeHooksGuard)
@Controller("auth")
export class SocialController {
  constructor(
    private readonly authorization: SocialAuthorizationService,
    private readonly callbacks: SocialCallbackService,
    private readonly authenticator: Authenticator,
  ) {}

  @ApiRoute(signInSocialRoute)
  async signInSocial(
    @Input() input: RouteInput<typeof signInSocialRoute>,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedRedirects(input.json);
    const url = await this.authorization.start(input.json, response);
    return authorizationReply(url, input.json.disableRedirect);
  }

  @ApiRoute(linkSocialRoute)
  async linkSocial(
    @Input() input: RouteInput<typeof linkSocialRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedRedirects(input.json);
    const user = requireSignedInUser(
      await this.authenticator.authenticate(request),
    );
    const url = await this.authorization.start(input.json, response, {
      userId: user.id,
      email: user.email,
    });
    return authorizationReply(url, input.json.disableRedirect);
  }

  @ApiRoute(socialCallbackRoute)
  async callback(
    @Input() input: RouteInput<typeof socialCallbackRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    let location: string;
    try {
      location = await this.callbacks.handle(
        input.param.id,
        request.query,
        request,
        response,
      );
    } catch (error) {
      if (!(error instanceof OAuthRedirect)) throw error;
      location = error.location;
    }
    return reply(302, undefined, { Location: location });
  }

  @ApiRoute(oauthErrorRoute)
  errorPage(@Req() request: Request) {
    const query = new URL(request.originalUrl, "http://localhost").searchParams;
    const page = oauthErrorPage(query);
    return page.redirect !== undefined
      ? reply(302, undefined, { Location: page.redirect })
      : reply(200, page.html, { "Content-Type": "text/html; charset=utf-8" });
  }

  // Providers that answer with `response_mode=form_post` post here; the
  // parameters are moved to the query of the GET callback.
  @ApiRoute(socialCallbackPostRoute)
  callbackPost(
    @Input() input: RouteInput<typeof socialCallbackPostRoute>,
    @Req() request: Request,
  ) {
    const body: unknown = request.body;
    const merged = {
      ...(body && typeof body === "object" ? body : {}),
      ...request.query,
    } as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (typeof value === "string") params.set(key, value);
    }
    const location = `${authBaseURL()}/callback/${input.param.id}?${params.toString()}`;
    return reply(302, undefined, { Location: location });
  }
}
