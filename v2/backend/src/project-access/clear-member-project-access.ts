import type { EntityManager } from "typeorm";
import { WorkspaceMemberAccessEntity } from "../database/entities/workspace-member-access.entity";
import { WorkspaceMemberProjectEntity } from "../database/entities/workspace-member-project.entity";

export async function clearMemberProjectAccess(
  manager: EntityManager,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await manager.delete(WorkspaceMemberProjectEntity, { workspaceId, userId });
  await manager.delete(WorkspaceMemberAccessEntity, { workspaceId, userId });
}
