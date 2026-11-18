import { Controller, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { authError } from "../auth-error";
import { CurrentPrincipal } from "../current-user.decorator";
import type { Principal } from "../principal";
import { CurrentSessionService } from "../sessions/current-session.service";
import { assertTrustedRedirects } from "../sign-in-policy/assert-trusted-redirects";
import { deleteUserRoute } from "./delete-user.routes";
import { DeleteUserService } from "./delete-user.service";

@Controller("auth")
export class DeleteUserController {
  constructor(
    private readonly deletions: DeleteUserService,
    private readonly current: CurrentSessionService,
  ) {}

  @ApiRoute(deleteUserRoute)
  async deleteUser(
    @Input() input: RouteInput<typeof deleteUserRoute>,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ) {
    // A signed-in person deletes their own account; an API key cannot.
    if (!principal.user || !principal.session) throw authError("UNAUTHORIZED");
    assertTrustedRedirects({ callbackURL: input.json.callbackURL });
    const result = await this.deletions.deleteUser(
      principal.user,
      principal.session,
      input.json,
    );
    this.current.clear(response);
    return result;
  }
}
