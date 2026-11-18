import { Controller, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { Public } from "../public.decorator";
import { AuthBeforeHooksGuard } from "../sign-in-policy/auth-before-hooks.guard";
import { assertTrustedRedirects } from "../sign-in-policy/assert-trusted-redirects";
import {
  requestPasswordResetRoute,
  resetPasswordCallbackRoute,
  resetPasswordRoute,
} from "./password-reset.routes";
import { PasswordResetService } from "./password-reset.service";

@Public()
@UseGuards(AuthBeforeHooksGuard)
@Controller("auth")
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @ApiRoute(requestPasswordResetRoute)
  requestReset(
    @Input() input: RouteInput<typeof requestPasswordResetRoute>,
    @Req() request: Request,
  ) {
    assertTrustedRedirects({ redirectTo: input.json.redirectTo });
    return this.resets.request(
      input.json.email,
      input.json.redirectTo,
      request.get("user-agent"),
    );
  }

  @ApiRoute(resetPasswordCallbackRoute)
  async callback(
    @Input() input: RouteInput<typeof resetPasswordCallbackRoute>,
  ) {
    assertTrustedRedirects({ callbackURL: input.query.callbackURL });
    const location = await this.resets.callbackLocation(
      input.param.token,
      input.query.callbackURL,
    );
    return reply(302, undefined, { Location: location });
  }

  @ApiRoute(resetPasswordRoute)
  reset(@Input() input: RouteInput<typeof resetPasswordRoute>) {
    return this.resets.reset(
      input.json.token || input.query.token,
      input.json.newPassword,
    );
  }
}
