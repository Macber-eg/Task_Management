import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ColumnEntity } from "../database/entities/column.entity";
import { TaskEntity } from "../database/entities/task.entity";
import { EventBus } from "../events/event-bus";

@Injectable()
export class ColumnDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  /** Deletes an empty column; one that holds tasks is refused. */
  async deleteColumn(id: string): Promise<ColumnEntity> {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(ColumnEntity, { where: { id } });

    if (!existing) {
      throw new HTTPException(404, { message: "Column not found" });
    }

    const taskCount = await manager.count(TaskEntity, {
      where: { columnId: id },
    });

    if (taskCount > 0) {
      throw new HTTPException(409, {
        message:
          "Cannot delete column that contains tasks. Move or delete tasks first.",
      });
    }

    await manager.delete(ColumnEntity, { id });

    await this.events.publish("project.updated", {
      projectId: existing.projectId,
    });

    return existing;
  }
}
