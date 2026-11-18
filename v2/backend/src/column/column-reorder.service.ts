import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { ColumnEntity } from "../database/entities/column.entity";
import { EventBus } from "../events/event-bus";

@Injectable()
export class ColumnReorderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async reorderColumns(
    projectId: string,
    columns: Array<{ id: string; position: number }>,
  ): Promise<ColumnEntity[]> {
    const updated = await this.dataSource.transaction(async (tx) => {
      // Updated in id order so concurrent reorders lock rows in one order.
      for (const column of [...columns].sort((left, right) =>
        left.id.localeCompare(right.id),
      )) {
        const [row] = await updateReturning(
          tx,
          ColumnEntity,
          { position: column.position },
          { id: column.id, projectId },
        );

        if (!row) {
          throw new HTTPException(400, {
            message: `Column ${column.id} does not belong to this project`,
          });
        }
      }

      return tx.find(ColumnEntity, {
        where: { projectId },
        order: { position: "ASC" },
      });
    });

    await this.events.publish("project.updated", { projectId });

    return updated;
  }
}
