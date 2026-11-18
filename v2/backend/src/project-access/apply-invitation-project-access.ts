import type { EntityManager } from "typeorm";
import { isOwnerRole } from "./is-owner-role";
import { replaceMemberProjectAccess } from "./replace-member-project-access";

/** Gives a user joining through an invitation the project access it was issued with. */
export async function applyInvitationProjectAccess(
  manager: EntityManager,
  invitation: {
    workspaceId: string;
    role: string | null;
    projectAccess: string;
    projectIds: readonly string[];
  },
  userId: string,
): Promise<void> {
  const restricted =
    invitation.projectAccess === "selected" && !isOwnerRole(invitation.role);
  await manager.transaction((tx) =>
    replaceMemberProjectAccess(tx, {
      workspaceId: invitation.workspaceId,
      userId,
      projectAccess: restricted ? "selected" : "all",
      projectIds: invitation.projectIds,
    }),
  );
}
