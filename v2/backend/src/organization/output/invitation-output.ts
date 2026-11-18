import type { InvitationEntity } from "../../database/entities/invitation.entity";

export function invitationOutput(invitation: InvitationEntity) {
  return {
    id: invitation.id,
    organizationId: invitation.workspaceId,
    email: invitation.email,
    role: invitation.role,
    teamId: invitation.teamId,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    inviterId: invitation.inviterId,
    projectAccess: invitation.projectAccess,
    projectIds: invitation.projectIds,
  };
}

export type InvitationOutput = ReturnType<typeof invitationOutput>;
