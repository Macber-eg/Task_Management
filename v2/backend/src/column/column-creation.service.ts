import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { ColumnEntity } from "../database/entities/column.entity";
import { EventBus } from "../events/event-bus";
import { toSlug } from "./to-slug";

// Task statuses that live outside the board columns (the task area's list).
const VIRTUAL_STATUSES: readonly string[] = ["planned", "archived"];

export type NewColumn = {
  projectId: string;
  name: string;
  icon?: string;
  color?: string;
  isFinal?: boolean;
};

@Injectable()
export class ColumnCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async createColumn({
    projectId,
    name,
    icon,
    color,
    isFinal,
  }: NewColumn): Promise<ColumnEntity> {
    const manager = this.dataSource.manager;
    const slug = toSlug(name);

    if (!slug) {
      throw new HTTPException(400, {
        message: "Column name must contain at least one alphanumeric character",
      });
    }

    if (VIRTUAL_STATUSES.includes(slug)) {
      throw new HTTPException(409, {
        message: `Column slug "${slug}" is reserved for virtual task statuses`,
      });
    }

    const existing = await manager.find(ColumnEntity, {
      where: { projectId, slug },
      select: { id: true },
    });

    if (existing.length > 0) {
      throw new HTTPException(409, {
        message: `Column with slug "${slug}" already exists in this project`,
      });
    }

    const [maxPosition] = (await manager.query(
      `SELECT COALESCE(MAX(position), -1) AS "maxPosition"
       FROM "column" WHERE project_id = $1`,
      [projectId],
    )) as { maxPosition: number }[];

    const position = (maxPosition?.maxPosition ?? -1) + 1;

    const created = await insertReturning(manager, ColumnEntity, {
      projectId,
      name,
      slug,
      position,
      icon: icon || null,
      color: color || null,
      isFinal: isFinal ?? false,
    });

    if (!created) {
      throw new HTTPException(500, { message: "Failed to create column" });
    }

    await this.events.publish("project.updated", {
      projectId: created.projectId,
    });

    return created;
  }
}
