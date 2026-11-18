import type { EntityManager } from "typeorm";
import { WorkspaceMemberAccessEntity } from "../database/entities/workspace-member-access.entity";
import { WorkspaceMemberProjectEntity } from "../database/entities/workspace-member-project.entity";
import type { MemberProjectAccess } from "./member-project-access-type";

/** The access stored for a member, whatever their role. */
export async function getMemberProjectAccess(
  manager: EntityManager,
  workspaceId: string,
  userId: string,
): Promise<MemberProjectAccess> {
  const rule = await manager.findOne(WorkspaceMemberAccessEntity, {
    where: { workspaceId, userId },
    select: { projectAccess: true },
  });

  if (!rule || rule.projectAccess === "all") {
    return { userId, projectAccess: "all", projectIds: [] };
  }

  const grants = await manager.find(WorkspaceMemberProjectEntity, {
    where: { workspaceId, userId },
    select: { projectId: true },
  });

  return {
    userId,
    projectAccess: "selected",
    projectIds: grants.map((grant) => grant.projectId),
  };
}
