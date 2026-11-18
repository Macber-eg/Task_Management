import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { InvitationEntity } from "../../database/entities/invitation.entity";
import { findMember } from "../lookups/find-member";
import { findWorkspaceById } from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { invitationOutput } from "../output/invitation-output";
import { hideInaccessibleInvitationProjects } from "./hide-inaccessible-invitation-projects";

// The previous backend read at most this many invitations per list.
const LIST_LIMIT = 100;

@Injectable()
export class InvitationLookupService {
  constructor(private readonly dataSource: DataSource) {}

  /** One pending invitation, for its recipient, with who sent it and where to. */
  async get(caller: OrganizationCaller, invitationId: string) {
    const manager = this.dataSource.manager;
    const invitation = await manager.findOne(InvitationEntity, {
      where: { id: invitationId },
    });
    if (
      !invitation ||
      invitation.status !== "pending" ||
      invitation.expiresAt < new Date()
    ) {
      throw new HTTPException(400, { message: "Invitation not found!" });
    }
    if (invitation.email.toLowerCase() !== caller.user.email.toLowerCase()) {
      throw organizationError(403, "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION");
    }
    const workspace = await findWorkspaceById(manager, invitation.workspaceId);
    if (!workspace) throw organizationError(400, "ORGANIZATION_NOT_FOUND");
    const inviter = await findMember(
      manager,
      invitation.inviterId,
      invitation.workspaceId,
    );
    if (!inviter) {
      throw organizationError(
        400,
        "INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION",
      );
    }
    return {
      ...invitationOutput(invitation),
      organizationName: workspace.name,
      organizationSlug: workspace.slug,
      inviterEmail: inviter.user.email,
    };
  }

  /** Every invitation of a workspace, for its members. */
  async listForWorkspace(
    caller: OrganizationCaller,
    organizationId: string | undefined,
  ) {
    const manager = this.dataSource.manager;
    const workspaceId = organizationId || activeOrganizationOf(caller);
    if (!workspaceId) {
      throw new HTTPException(400, { message: "Organization ID is required" });
    }
    if (!(await findMember(manager, caller.user.id, workspaceId))) {
      throw new HTTPException(403, {
        message: "You are not a member of this organization",
      });
    }
    const invitations = await manager.find(InvitationEntity, {
      where: { workspaceId },
      take: LIST_LIMIT,
    });
    return hideInaccessibleInvitationProjects(
      manager,
      caller.user.id,
      invitations.map(invitationOutput),
    );
  }

  /** The pending invitations addressed to the caller's email. */
  async listForUser(caller: OrganizationCaller) {
    if (!caller.user.emailVerified) {
      throw organizationError(403, "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION");
    }
    const invitations = await this.dataSource.manager.find(InvitationEntity, {
      where: { email: caller.user.email.toLowerCase() },
      relations: { workspace: true },
      take: LIST_LIMIT,
    });
    return invitations
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => ({
        ...invitationOutput(invitation),
        organizationName: invitation.workspace?.name,
      }));
  }
}
