import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { Public } from "../public.decorator";
import { assertFormCsrf } from "../sign-in-policy/assert-form-csrf";
import { assertTrustedRedirects } from "../sign-in-policy/assert-trusted-redirects";
import { AuthBeforeHooksGuard } from "../sign-in-policy/auth-before-hooks.guard";
import { signInMagicLinkRoute, verifyMagicLinkRoute } from "./magic-link.routes";
import { decodeUrlParameter } from "./decode-url-parameter";
import { MagicLinkService } from "./magic-link.service";

@Public()
@UseGuards(AuthBeforeHooksGuard)
@Controller("auth")
export class MagicLinkController {
  constructor(private readonly links: MagicLinkService) {}

  @ApiRoute(signInMagicLinkRoute)
  send(
    @Input() input: RouteInput<typeof signInMagicLinkRoute>,
    @Req() request: Request,
  ) {
    assertTrustedRedirects(input.json);
    assertFormCsrf(request);
    return this.links.send(input.json, request.get("user-agent"));
  }

  @ApiRoute(verifyMagicLinkRoute)
  verify(
    @Input() input: RouteInput<typeof verifyMagicLinkRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Each target is checked as a callback URL, as the previous backend did.
    for (const url of [
      input.query.callbackURL,
      input.query.newUserCallbackURL,
      input.query.errorCallbackURL,
    ]) {
      assertTrustedRedirects({
        callbackURL: url ? decodeUrlParameter(url) : undefined,
      });
    }
    return this.links.verify(input.query, request, response);
  }
}
