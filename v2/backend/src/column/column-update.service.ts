import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { ColumnEntity } from "../database/entities/column.entity";
import { EventBus } from "../events/event-bus";
import { getProjectSubtaskParentProjects } from "../project/project-subtask-parents";

export type ColumnChanges = {
  name?: string;
  icon?: string | null;
  color?: string | null;
  isFinal?: boolean;
};

@Injectable()
export class ColumnUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  /** Omitted fields are left unchanged. */
  async updateColumn(id: string, data: ColumnChanges): Promise<ColumnEntity> {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(ColumnEntity, { where: { id } });

    if (!existing) {
      throw new HTTPException(404, { message: "Column not found" });
    }

    const changes: QueryDeepPartialEntity<ColumnEntity> = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.icon !== undefined && { icon: data.icon }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.isFinal !== undefined && { isFinal: data.isFinal }),
    };
    const [updated] = await updateReturning(manager, ColumnEntity, changes, {
      id,
    });

    if (!updated) {
      throw new HTTPException(500, { message: "Failed to update column" });
    }

    if (existing.isFinal !== updated.isFinal) {
      // Parent boards count a subtask as done when it sits in a final column.
      const parents = await getProjectSubtaskParentProjects(
        manager,
        updated.projectId,
        updated.slug,
      );
      await this.events.publish("subtask-parents.refresh", {
        projects: [
          { projectId: updated.projectId },
          ...parents.filter((parent) => parent.projectId !== updated.projectId),
        ],
      });
    }

    await this.events.publish("project.updated", {
      projectId: updated.projectId,
    });

    return updated;
  }
}
