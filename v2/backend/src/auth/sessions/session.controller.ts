import { Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { authError } from "../auth-error";
import { Public } from "../public.decorator";
import { CurrentSessionService } from "./current-session.service";
import { getSessionRoute, refreshRoute, signOutRoute } from "./session.routes";

// Public because these routes decide for themselves what the request's
// credentials are worth: "no session" is an answer here, not a 401.
@Public()
@Controller("auth")
export class SessionController {
  constructor(private readonly current: CurrentSessionService) {}

  @ApiRoute(getSessionRoute)
  async getSession(
    @Input() input: RouteInput<typeof getSessionRoute>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set("Cache-Control", "no-store");
    const session = await this.current.resolve(request, response, {
      allowRefresh: input.query.disableRefresh !== "true",
    });
    return session ?? reply(200, null);
  }

  @ApiRoute(refreshRoute)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set("Cache-Control", "no-store");
    const issued = await this.current.renew(request, response);
    if (!issued) {
      this.current.clear(response);
      throw authError("SESSION_EXPIRED");
    }
    return { token: issued.accessToken };
  }

  @ApiRoute(signOutRoute)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.current.end(request, response);
    return { success: true };
  }
}
