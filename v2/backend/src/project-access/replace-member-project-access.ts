import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { insertReturning } from "../database/dml";
import { WorkspaceMemberAccessEntity } from "../database/entities/workspace-member-access.entity";
import { WorkspaceMemberProjectEntity } from "../database/entities/workspace-member-project.entity";
import { clearMemberProjectAccess } from "./clear-member-project-access";
import { findWorkspaceProjectIds } from "./find-workspace-project-ids";
import type { ProjectAccessMode } from "./project-access-mode";

export async function replaceMemberProjectAccess(
  manager: EntityManager,
  access: {
    workspaceId: string;
    userId: string;
    projectAccess: ProjectAccessMode;
    projectIds: readonly string[];
  },
): Promise<void> {
  const { workspaceId, userId, projectAccess } = access;

  if (projectAccess === "all") {
    await clearMemberProjectAccess(manager, workspaceId, userId);
    return;
  }

  await insertReturning(
    manager,
    WorkspaceMemberAccessEntity,
    { workspaceId, userId, projectAccess, updatedAt: new Date() },
    {
      onConflict: {
        target: ["workspaceId", "userId"],
        update: ["projectAccess", "updatedAt"],
      },
    },
  );

  await manager.delete(WorkspaceMemberProjectEntity, { workspaceId, userId });

  const projectIds = await findWorkspaceProjectIds(
    manager,
    workspaceId,
    access.projectIds,
  );

  if (projectIds.length === 0) return;

  await manager.query(
    `INSERT INTO workspace_member_project (id, workspace_id, user_id, project_id)
     SELECT grant_row.id, $1, $2, grant_row.project_id
     FROM unnest($3::text[], $4::text[]) AS grant_row(id, project_id)
     ON CONFLICT DO NOTHING`,
    [workspaceId, userId, projectIds.map(() => createId()), projectIds],
  );
}
