import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { ProjectAccessService } from "../access/project-access.service";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectEntity } from "../database/entities/project.entity";
import { lockProjectOrdering } from "./project-placement";

@Injectable()
export class ProjectReorderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async reorderProjects(
    workspaceId: string,
    userId: string,
    projects: Array<{ id: string; position: number }>,
  ): Promise<ProjectEntity[]> {
    const ids = projects.map((project) => project.id);

    if (new Set(ids).size !== ids.length) {
      throw new HTTPException(400, {
        message: "Duplicate project ids in reorder payload",
      });
    }

    await this.projectAccess.assertProjectAccess(userId, ids);

    return this.dataSource.transaction(async (tx) => {
      await lockProjectOrdering(tx, workspaceId);

      // The whole workspace, not just the payload: archived projects are never
      // sent but have to hold their place. This order is each project's
      // current rank, which the renumbering below pins them to.
      const existing = await tx.find(ProjectEntity, {
        where: { workspaceId },
        select: { id: true, position: true },
        order: { position: "ASC", createdAt: "ASC", id: "ASC" },
      });

      // Verify the whole batch before writing, so a smuggled foreign id
      // cannot leave the workspace half-renumbered.
      const ownedIds = new Set(existing.map((project) => project.id));
      const foreignId = ids.find((id) => !ownedIds.has(id));

      if (foreignId) {
        throw new HTTPException(400, {
          message: `Project ${foreignId} does not belong to this workspace`,
        });
      }

      // The payload only expresses a relative order; positions are derived
      // here so they stay 0..n-1 without duplicates or gaps.
      const requestedOrder = [...projects]
        .sort((a, b) => a.position - b.position)
        .map((project) => project.id);
      const requestedIds = new Set(requestedOrder);

      // Omitted projects keep their rank and the payload fills the slots
      // around them, so an archived project does not sink to the bottom.
      const requested = requestedOrder[Symbol.iterator]();
      const finalOrder = existing.map((project) =>
        requestedIds.has(project.id)
          ? (requested.next().value ?? project.id)
          : project.id,
      );

      const currentPositions = new Map(
        existing.map((project) => [project.id, project.position]),
      );

      for (const [position, id] of finalOrder.entries()) {
        if (currentPositions.get(id) === position) continue;
        await tx.update(ProjectEntity, { id }, { position });
      }

      return tx
        .createQueryBuilder(ProjectEntity, "project")
        .where("project.workspaceId = :workspaceId", { workspaceId })
        .andWhere(projectAccessCondition(":userId", "project.id"), { userId })
        .orderBy("project.position", "ASC")
        .addOrderBy("project.createdAt", "ASC")
        .addOrderBy("project.id", "ASC")
        .getMany();
    });
  }
}
