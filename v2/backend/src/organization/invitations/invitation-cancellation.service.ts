import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { updateReturning } from "../../database/dml";
import { InvitationEntity } from "../../database/entities/invitation.entity";
import { findMember } from "../lookups/find-member";
import { findWorkspaceById } from "../lookups/find-workspace";
import type { OrganizationCaller } from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { invitationOutput } from "../output/invitation-output";
import { OrganizationPermissionService } from "../roles/organization-permission.service";

@Injectable()
export class InvitationCancellationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: OrganizationPermissionService,
  ) {}

  async cancel(caller: OrganizationCaller, invitationId: string) {
    const manager = this.dataSource.manager;
    const invitation = await manager.findOne(InvitationEntity, {
      where: { id: invitationId },
    });
    if (!invitation) throw organizationError(400, "INVITATION_NOT_FOUND");

    const workspaceId = invitation.workspaceId;
    const actor = await findMember(manager, caller.user.id, workspaceId);
    if (!actor) throw organizationError(400, "MEMBER_NOT_FOUND");
    const allowed = await this.permissions.hasPermission({
      workspaceId,
      role: actor.member.role,
      permissions: { invitation: ["cancel"] },
    });
    if (!allowed) {
      throw organizationError(403, "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION");
    }
    if (!(await findWorkspaceById(manager, workspaceId))) {
      throw organizationError(400, "ORGANIZATION_NOT_FOUND");
    }

    const [canceled] = await updateReturning(
      manager,
      InvitationEntity,
      { status: "canceled" },
      { id: invitationId },
    );
    return canceled ? invitationOutput(canceled) : null;
  }
}
