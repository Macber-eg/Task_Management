import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { Public } from "../public.decorator";
import { assertFormCsrf } from "../sign-in-policy/assert-form-csrf";
import { AuthBeforeHooksGuard } from "../sign-in-policy/auth-before-hooks.guard";
import { sendVerificationOtpRoute, signInEmailOtpRoute } from "./email-otp.routes";
import { EmailOtpService } from "./email-otp.service";

// With DISABLE_EMAIL_OTP_SIGN_IN the guard answers 404, as if unrouted.
@Public()
@UseGuards(AuthBeforeHooksGuard)
@Controller("auth")
export class EmailOtpController {
  constructor(private readonly otp: EmailOtpService) {}

  @ApiRoute(sendVerificationOtpRoute)
  send(
    @Input() input: RouteInput<typeof sendVerificationOtpRoute>,
    @Req() request: Request,
  ) {
    assertFormCsrf(request);
    return this.otp.send(
      input.json.email,
      input.json.type,
      request.get("user-agent"),
    );
  }

  @ApiRoute(signInEmailOtpRoute)
  signIn(
    @Input() input: RouteInput<typeof signInEmailOtpRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.otp.signIn(input.json, request, response);
  }
}
