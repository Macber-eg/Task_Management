import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { Public } from "../public.decorator";
import { CurrentSessionService } from "../sessions/current-session.service";
import { userOutput } from "../sessions/session-output";
import { AuthBeforeHooksGuard } from "../sign-in-policy/auth-before-hooks.guard";
import { signInEmailRoute, signUpEmailRoute } from "./email-password.routes";
import { SignInService } from "./sign-in.service";
import { readSignUpInvitation } from "./sign-up-invitation";
import { SignUpService } from "./sign-up.service";

@Public()
@UseGuards(AuthBeforeHooksGuard)
@Controller("auth")
export class EmailPasswordController {
  constructor(
    private readonly signUps: SignUpService,
    private readonly signIns: SignInService,
    private readonly current: CurrentSessionService,
  ) {}

  @ApiRoute(signUpEmailRoute)
  async signUp(
    @Input() input: RouteInput<typeof signUpEmailRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.signUps.signUp(
      input.json,
      readSignUpInvitation(request, input.json),
    );
    const issued = await this.current.start(user, request, response, {
      rememberMe: input.json.rememberMe,
    });
    return { token: issued.accessToken, user: userOutput(issued.user) };
  }

  @ApiRoute(signInEmailRoute)
  async signIn(
    @Input() input: RouteInput<typeof signInEmailRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.signIns.signIn(
      input.json.email,
      input.json.password,
    );
    const issued = await this.current.start(user, request, response, {
      rememberMe: input.json.rememberMe,
    });
    return {
      redirect: false,
      token: issued.accessToken,
      user: userOutput(issued.user),
    };
  }
}
