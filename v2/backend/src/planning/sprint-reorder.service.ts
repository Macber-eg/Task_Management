import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectSprintEntity } from "../database/entities/project-sprint.entity";
import type { ReorderSprintItem } from "./schema";

@Injectable()
export class SprintReorderService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Moves sprints in one transaction, in id order so concurrent reorders
   * lock rows in the same sequence. Answers with the project's sprints.
   */
  async reorderSprints(projectId: string, sprints: ReorderSprintItem[]) {
    if (sprints.length === 0) {
      throw new HTTPException(400, { message: "No sprints to reorder" });
    }

    return this.dataSource.transaction(async (tx) => {
      for (const item of [...sprints].sort((left, right) =>
        left.id.localeCompare(right.id),
      )) {
        const existing = await tx.findOne(ProjectSprintEntity, {
          where: { id: item.id, projectId },
        });

        if (!existing) {
          throw new HTTPException(400, {
            message: `Sprint ${item.id} does not belong to this project`,
          });
        }

        const nextPhaseId =
          item.phaseId === undefined
            ? existing.phaseId
            : item.phaseId === ""
              ? null
              : item.phaseId;

        await tx.update(
          ProjectSprintEntity,
          { id: item.id },
          {
            position: item.position,
            ...(item.phaseId !== undefined ? { phaseId: nextPhaseId } : {}),
            updatedAt: new Date(),
          },
        );
      }

      return tx.find(ProjectSprintEntity, {
        where: { projectId },
        order: { position: "ASC" },
      });
    });
  }
}
