import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { ProjectEntity } from "../../database/entities/project.entity";

/**
 * The project, provided it is still in the workspace the request was
 * authorized for; `lock` holds it (FOR SHARE) for the transaction.
 */
export async function getAuthorizedSyncProject(
  db: EntityManager,
  projectId: string,
  authorizedWorkspaceId: string,
  lock = false,
): Promise<ProjectEntity> {
  let query = db
    .createQueryBuilder(ProjectEntity, "project")
    .where("project.id = :projectId", { projectId })
    .andWhere("project.workspace_id = :authorizedWorkspaceId", {
      authorizedWorkspaceId,
    });
  if (lock) query = query.setLock("pessimistic_read");
  const project = await query.getOne();
  if (!project)
    throw new HTTPException(403, {
      message: "Project no longer belongs to the authorized workspace",
    });
  return project;
}
