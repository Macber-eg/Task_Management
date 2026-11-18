import { Injectable } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectPhaseEntity } from "../database/entities/project-phase.entity";
import { assertValidPhaseParent } from "./phase-parent";
import type { ReorderPhaseItem } from "./schema";

@Injectable()
export class PhaseReorderService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Moves folders in one transaction, in id order so concurrent reorders
   * lock rows in the same sequence. Answers with the unarchived folders.
   */
  async reorderPhases(projectId: string, phases: ReorderPhaseItem[]) {
    if (phases.length === 0) {
      throw new HTTPException(400, { message: "No phases to reorder" });
    }

    return this.dataSource.transaction(async (tx) => {
      for (const item of [...phases].sort((left, right) =>
        left.id.localeCompare(right.id),
      )) {
        const existing = await tx.findOne(ProjectPhaseEntity, {
          where: { id: item.id, projectId },
        });

        if (!existing) {
          throw new HTTPException(400, {
            message: `Folder ${item.id} does not belong to this project`,
          });
        }

        const nextParentId =
          item.parentId === undefined
            ? existing.parentId
            : item.parentId === ""
              ? null
              : item.parentId;

        if (item.parentId !== undefined) {
          // Outside the transaction, as before: the hierarchy is checked
          // against committed rows, not this request's earlier moves.
          await assertValidPhaseParent(this.dataSource.manager, {
            projectId,
            parentId: nextParentId,
            phaseId: item.id,
          });
        }

        await tx.update(
          ProjectPhaseEntity,
          { id: item.id },
          {
            position: item.position,
            ...(item.parentId !== undefined ? { parentId: nextParentId } : {}),
            updatedAt: new Date(),
          },
        );
      }

      return tx.find(ProjectPhaseEntity, {
        where: { projectId, archivedAt: IsNull() },
        order: { position: "ASC" },
      });
    });
  }
}
