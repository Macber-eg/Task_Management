import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { Principal } from "../auth/principal";
import { getInvitationDetails } from "../auth/registration/get-invitation-details";
import { getUserPendingInvitations } from "../auth/registration/get-user-pending-invitations";

@Injectable()
export class InvitationQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Invitations are matched by email, so an unverified address sees none: it
   * may not be the caller's. An API key carries no user and sees none either.
   */
  async getUserPendingInvitations(principal: Principal) {
    if (!principal.user?.emailVerified) {
      return [];
    }
    return getUserPendingInvitations(
      this.dataSource.manager,
      principal.userEmail,
    );
  }

  getInvitationDetails(invitationId: string) {
    return getInvitationDetails(this.dataSource.manager, invitationId);
  }
}
