import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { Public } from "../public.decorator";
import { assertTrustedRedirects } from "../sign-in-policy/assert-trusted-redirects";
import { AuthBeforeHooksGuard } from "../sign-in-policy/auth-before-hooks.guard";
import { OAuthRedirect } from "../social/oauth-redirect";
import { OidcAuthorizationService } from "./oidc-authorization.service";
import { OidcCallbackService } from "./oidc-callback.service";
import { oauth2CallbackRoute, signInOAuth2Route } from "./oidc.routes";

/** The generic OIDC/OAuth2 provider (`custom`). */
@Public()
// Sign-in initiation is subject to the shared pre-sign-in checks (CAPTCHA).
@UseGuards(AuthBeforeHooksGuard)
@Controller("auth")
export class OidcController {
  constructor(
    private readonly authorization: OidcAuthorizationService,
    private readonly callbacks: OidcCallbackService,
  ) {}

  @ApiRoute(signInOAuth2Route)
  async signIn(
    @Input() input: RouteInput<typeof signInOAuth2Route>,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedRedirects(input.json);
    const url = await this.authorization.start(input.json, response);
    return { url: url.toString(), redirect: !input.json.disableRedirect };
  }

  @ApiRoute(oauth2CallbackRoute)
  async callback(
    @Input() input: RouteInput<typeof oauth2CallbackRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    let location: string;
    try {
      location = await this.callbacks.handle(
        input.param.providerId,
        input.query,
        request,
        response,
      );
    } catch (error) {
      if (!(error instanceof OAuthRedirect)) throw error;
      location = error.location;
    }
    return reply(302, undefined, { Location: location });
  }
}
