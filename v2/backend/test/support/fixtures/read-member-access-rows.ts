import type { EntityManager } from "typeorm";
import { WorkspaceMemberAccessEntity } from "../../../src/database/entities/workspace-member-access.entity";
import { WorkspaceMemberProjectEntity } from "../../../src/database/entities/workspace-member-project.entity";

/** What is stored about a member's project access. */
export async function readMemberAccessRows(
  db: EntityManager,
  workspaceId: string,
  userId: string,
) {
  const where = { workspaceId, userId };
  return {
    rules: await db.find(WorkspaceMemberAccessEntity, { where }),
    grants: await db.find(WorkspaceMemberProjectEntity, { where }),
  };
}
