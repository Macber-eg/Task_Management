import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiRoute } from "../../common/openapi";
import { Public } from "../public.decorator";
import { AuthBeforeHooksGuard } from "../sign-in-policy/auth-before-hooks.guard";
import { signInAnonymousRoute } from "./anonymous.routes";
import { AnonymousSignInService } from "./anonymous-sign-in.service";

@Public()
@UseGuards(AuthBeforeHooksGuard)
@Controller("auth")
export class AnonymousController {
  constructor(private readonly guests: AnonymousSignInService) {}

  @ApiRoute(signInAnonymousRoute)
  signIn(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.guests.signIn(request, response);
  }
}
