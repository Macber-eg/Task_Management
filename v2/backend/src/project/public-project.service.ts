import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectEntity } from "../database/entities/project.entity";
import { boundedTaskRead } from "./public-board/bounded-task-read";
import type { PublicBoardOptions } from "./public-board/public-board-query";
import { readPublicBoard } from "./public-board/read-public-board";

const NOT_PUBLIC = "Project is not public";

@Injectable()
export class PublicProjectService {
  constructor(private readonly dataSource: DataSource) {}

  /** Visibility is checked before any task is loaded, and again in the read. */
  async getPublicProject(id: string, options: PublicBoardOptions) {
    const project = await this.dataSource.manager.findOne(ProjectEntity, {
      where: { id },
      select: { id: true, isPublic: true },
    });

    if (!project) {
      throw new HTTPException(404, {
        message: "Project not found",
      });
    }

    if (!project.isPublic) {
      throw new HTTPException(403, { message: NOT_PUBLIC });
    }

    const result = await boundedTaskRead(
      this.dataSource,
      (tx) => readPublicBoard(tx, id, options),
      "Task list request took too long; retry later",
    );

    if (!result.data.isPublic) {
      throw new HTTPException(403, { message: NOT_PUBLIC });
    }

    return { ...result.data, pagination: result.pagination };
  }
}
