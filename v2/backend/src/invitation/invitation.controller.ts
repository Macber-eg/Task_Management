import { Controller } from "@nestjs/common";
import { CurrentPrincipal } from "../auth/current-user.decorator";
import type { Principal } from "../auth/principal";
import { Public } from "../auth/public.decorator";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  getInvitationRoute,
  getPendingRoute,
  getPublicInvitationRoute,
} from "./invitation.routes";
import { InvitationQueryService } from "./invitation-query.service";

// The static `pending` path must be registered before `:id`.
@Controller("invitation")
export class InvitationController {
  constructor(private readonly invitations: InvitationQueryService) {}

  @Public()
  @ApiRoute(getPublicInvitationRoute)
  getPublicInvitation(
    @Input() input: RouteInput<typeof getPublicInvitationRoute>,
  ) {
    return this.invitations.getInvitationDetails(input.param.id);
  }

  @ApiRoute(getPendingRoute)
  getPending(@CurrentPrincipal() principal: Principal) {
    return this.invitations.getUserPendingInvitations(principal);
  }

  @ApiRoute(getInvitationRoute)
  getInvitation(@Input() input: RouteInput<typeof getInvitationRoute>) {
    return this.invitations.getInvitationDetails(input.param.id);
  }
}
