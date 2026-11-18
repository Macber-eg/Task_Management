import { Controller } from "@nestjs/common";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { authError } from "../auth-error";
import { CurrentPrincipal } from "../current-user.decorator";
import type { Principal } from "../principal";
import { userOutput } from "../sessions/session-output";
import { SessionService } from "../sessions/session.service";
import {
  changePasswordRoute,
  listAccountsRoute,
  updateUserRoute,
} from "./account.routes";
import { AccountService } from "./account.service";

/** Account settings act on a signed-in person, never on an API key. */
function requireLogin(principal: Principal) {
  if (!principal.user || !principal.session) throw authError("UNAUTHORIZED");
  return { user: principal.user, session: principal.session };
}

@Controller("auth")
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly sessions: SessionService,
  ) {}

  @ApiRoute(updateUserRoute)
  async updateUser(
    @Input() input: RouteInput<typeof updateUserRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { user } = requireLogin(principal);
    if (input.json.email) throw authError("EMAIL_CAN_NOT_BE_UPDATED");
    await this.accounts.updateProfile(user.id, input.json);
    return { status: true };
  }

  @ApiRoute(changePasswordRoute)
  async changePassword(
    @Input() input: RouteInput<typeof changePasswordRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { user, session } = requireLogin(principal);
    await this.accounts.changePassword(user.id, session.id, input.json);
    return {
      token: input.json.revokeOtherSessions
        ? await this.sessions.issueAccessToken({ user, session })
        : null,
      user: userOutput(user),
    };
  }

  @ApiRoute(listAccountsRoute)
  listAccounts(@CurrentPrincipal() principal: Principal) {
    return this.accounts.listAccounts(requireLogin(principal).user.id);
  }
}
