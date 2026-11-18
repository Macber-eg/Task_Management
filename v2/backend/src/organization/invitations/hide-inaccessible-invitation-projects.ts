import type { EntityManager } from "typeorm";
import { findAccessibleProjects } from "../../project-access/find-accessible-projects";
import type { InvitationOutput } from "../output/invitation-output";

/**
 * Drops from each invitation the projects the viewer cannot see (and ones
 * since deleted), so a limited admin learns nothing about hidden projects.
 */
export async function hideInaccessibleInvitationProjects(
  manager: EntityManager,
  viewerId: string,
  invitations: InvitationOutput[],
): Promise<InvitationOutput[]> {
  const visible = await findAccessibleProjects(
    manager,
    viewerId,
    invitations.flatMap((invitation) => invitation.projectIds),
  );
  return invitations.map((invitation) => ({
    ...invitation,
    projectIds: invitation.projectIds.filter(
      (projectId) => visible.get(projectId) === invitation.organizationId,
    ),
  }));
}
