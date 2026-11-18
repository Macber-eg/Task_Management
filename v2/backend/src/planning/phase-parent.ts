import type { EntityManager } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectPhaseEntity } from "../database/entities/project-phase.entity";

/**
 * The parent folder a phase may be placed under, or null for the top level.
 * 400 when it is missing, archived, a document, or (when moving `phaseId`)
 * the phase itself or one of its descendants.
 */
export async function assertValidPhaseParent(
  manager: EntityManager,
  {
    projectId,
    parentId,
    phaseId,
  }: {
    projectId: string;
    parentId: string | null | undefined;
    phaseId?: string;
  },
) {
  if (parentId === undefined || parentId === null || parentId === "") {
    return null;
  }

  if (phaseId && parentId === phaseId) {
    throw new HTTPException(400, {
      message: "A folder cannot be its own parent",
    });
  }

  const parent = await manager.findOne(ProjectPhaseEntity, {
    where: { id: parentId, projectId },
  });

  if (!parent) {
    throw new HTTPException(400, {
      message: "Parent folder not found in this project",
    });
  }

  if (parent.archivedAt) {
    throw new HTTPException(400, {
      message: "Cannot nest under an archived folder",
    });
  }

  if (parent.kind === "document") {
    throw new HTTPException(400, {
      message: "Documents cannot contain nested items",
    });
  }

  if (phaseId) {
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === phaseId) {
        throw new HTTPException(400, {
          message: "Cannot move a folder inside its own descendant",
        });
      }
      const row: ProjectPhaseEntity | null = await manager.findOne(
        ProjectPhaseEntity,
        { where: { id: cursor }, select: { id: true, parentId: true } },
      );
      cursor = row?.parentId ?? null;
    }
  }

  return parent;
}

/** The position after the last phase under the same parent. */
export async function nextPhasePosition(
  manager: EntityManager,
  projectId: string,
  parentId: string | null,
) {
  const [result] = (await (parentId
    ? manager.query(
        `SELECT coalesce(max(position), -1) AS maximum FROM project_phase
         WHERE project_id = $1 AND parent_id = $2`,
        [projectId, parentId],
      )
    : manager.query(
        `SELECT coalesce(max(position), -1) AS maximum FROM project_phase
         WHERE project_id = $1 AND parent_id IS NULL`,
        [projectId],
      ))) as { maximum: number | string }[];

  return Number(result?.maximum ?? -1) + 1;
}
