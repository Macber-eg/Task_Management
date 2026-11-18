import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { projectAccessCondition } from "./project-access-condition";

@Injectable()
export class ProjectAccessService {
  constructor(private readonly dataSource: DataSource) {}

  async findInaccessibleProjectIds(
    userId: string,
    projectIds: readonly string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string[]> {
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return [];

    const rows = (await manager.query(
      `SELECT p.id FROM project AS p
       WHERE p.id = ANY($2::text[])
         AND NOT ${projectAccessCondition("$1", "p.id")}`,
      [userId, ids],
    )) as { id: string }[];

    return rows.map((row) => row.id);
  }

  async assertProjectAccess(
    userId: string,
    projectIds: string | readonly string[],
  ): Promise<void> {
    const ids = typeof projectIds === "string" ? [projectIds] : projectIds;
    const denied = await this.findInaccessibleProjectIds(userId, ids);
    if (denied.length > 0) {
      throw new HTTPException(403, {
        message: "You don't have access to this project",
      });
    }
  }
}
