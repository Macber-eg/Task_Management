import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { getMemberProjectAccess } from "../project-access/get-member-project-access";

/**
 * A member restricted to selected projects keeps seeing a project they
 * created or moved in.
 */
export async function grantProjectToRestrictedMember(
  manager: EntityManager,
  grant: { workspaceId: string; userId: string; projectId: string },
): Promise<void> {
  const access = await getMemberProjectAccess(
    manager,
    grant.workspaceId,
    grant.userId,
  );
  if (access.projectAccess === "all") return;

  await manager.query(
    `INSERT INTO workspace_member_project (id, workspace_id, user_id, project_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [createId(), grant.workspaceId, grant.userId, grant.projectId],
  );
}
