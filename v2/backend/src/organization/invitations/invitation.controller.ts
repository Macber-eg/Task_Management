import { Controller, Req } from "@nestjs/common";
import type { Request } from "express";
import { Authenticator } from "../../auth/authenticator";
import { CurrentPrincipal } from "../../auth/current-user.decorator";
import type { Principal } from "../../auth/principal";
import { Public } from "../../auth/public.decorator";
import { HTTPException } from "../../common/errors/http-exception";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { isCloud } from "../../config/is-cloud";
import { OrganizationCallerService } from "../organization-caller.service";
import { assertCloudInvitePolicy } from "./assert-cloud-invite-policy";
import {
  acceptInvitationRoute,
  cancelInvitationRoute,
  getInvitationRoute,
  inviteMemberRoute,
  listInvitationsRoute,
  listUserInvitationsRoute,
  rejectInvitationRoute,
} from "./invitation.routes";
import { InvitationCancellationService } from "./invitation-cancellation.service";
import { InvitationCreationService } from "./invitation-creation.service";
import { InvitationLookupService } from "./invitation-lookup.service";
import { InvitationResponseService } from "./invitation-response.service";

@Controller("auth/organization")
export class InvitationController {
  constructor(
    private readonly authenticator: Authenticator,
    private readonly callers: OrganizationCallerService,
    private readonly creation: InvitationCreationService,
    private readonly responses: InvitationResponseService,
    private readonly cancellation: InvitationCancellationService,
    private readonly lookup: InvitationLookupService,
  ) {}

  @ApiRoute(inviteMemberRoute)
  async inviteMember(
    @Input() input: RouteInput<typeof inviteMemberRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const caller = await this.callers.resolve(principal);
    if (isCloud()) assertCloudInvitePolicy(caller.user, input.json.email);
    return this.creation.invite(caller, input.json);
  }

  @ApiRoute(acceptInvitationRoute)
  async acceptInvitation(
    @Input() input: RouteInput<typeof acceptInvitationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.responses.accept(
      await this.callers.resolve(principal),
      input.json.invitationId,
    );
  }

  @ApiRoute(rejectInvitationRoute)
  async rejectInvitation(
    @Input() input: RouteInput<typeof rejectInvitationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.responses.reject(
      await this.callers.resolve(principal),
      input.json.invitationId,
    );
  }

  @ApiRoute(cancelInvitationRoute)
  async cancelInvitation(
    @Input() input: RouteInput<typeof cancelInvitationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const canceled = await this.cancellation.cancel(
      await this.callers.resolve(principal),
      input.json.invitationId,
    );
    return canceled ?? reply(200, null);
  }

  // Public: these two answered a missing session themselves, with their own
  // status and message.
  @Public()
  @ApiRoute(getInvitationRoute)
  async getInvitation(
    @Input() input: RouteInput<typeof getInvitationRoute>,
    @Req() request: Request,
  ) {
    const principal = await this.authenticator.authenticate(request);
    if (!principal) {
      throw new HTTPException(401, { message: "Not authenticated" });
    }
    return this.lookup.get(
      await this.callers.resolve(principal),
      input.query.id,
    );
  }

  @ApiRoute(listInvitationsRoute)
  async listInvitations(
    @Input() input: RouteInput<typeof listInvitationsRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.lookup.listForWorkspace(
      await this.callers.resolve(principal),
      input.query.organizationId,
    );
  }

  @Public()
  @ApiRoute(listUserInvitationsRoute)
  async listUserInvitations(
    @Input() input: RouteInput<typeof listUserInvitationsRoute>,
    @Req() request: Request,
  ) {
    if (input.query.email) {
      throw new HTTPException(400, {
        message: "User email cannot be passed for client side API calls.",
      });
    }
    const principal = await this.authenticator.authenticate(request);
    if (!principal) {
      throw new HTTPException(400, {
        message: "Missing session headers, or email query parameter.",
      });
    }
    return this.lookup.listForUser(await this.callers.resolve(principal));
  }
}
