import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { insertReturning } from "../database/dml";
import { ProjectRecentAccessEntity } from "../database/entities/project-recent-access.entity";

const MAX_RECENT = 30;
const LISTED_RECENT = 12;

export type RecentItem = {
  itemType: string;
  itemId: string;
  title: string;
  parentLabel?: string | null;
};

/** What a user opened lately in a project, newest first. */
@Injectable()
export class ProjectRecentService {
  constructor(private readonly dataSource: DataSource) {}

  listProjectRecent(
    projectId: string,
    userId: string,
  ): Promise<ProjectRecentAccessEntity[]> {
    return this.dataSource.manager.find(ProjectRecentAccessEntity, {
      where: { projectId, userId },
      order: { accessedAt: "DESC" },
      take: LISTED_RECENT,
    });
  }

  /** Records a visit, keeping at most 30 items per user and project. */
  async recordProjectRecent(
    projectId: string,
    userId: string,
    body: RecentItem,
  ): Promise<ProjectRecentAccessEntity[]> {
    const manager = this.dataSource.manager;
    await insertReturning(
      manager,
      ProjectRecentAccessEntity,
      {
        projectId,
        userId,
        itemType: body.itemType,
        itemId: body.itemId,
        title: body.title.trim(),
        parentLabel: body.parentLabel?.trim() || null,
        accessedAt: new Date(),
      },
      {
        onConflict: {
          target: ["projectId", "userId", "itemType", "itemId"],
          update: ["title", "parentLabel", "accessedAt"],
        },
      },
    );

    const rows = await manager.find(ProjectRecentAccessEntity, {
      where: { projectId, userId },
      select: { id: true },
      order: { accessedAt: "DESC" },
    });

    if (rows.length > MAX_RECENT) {
      const staleIds = rows.slice(MAX_RECENT).map((row) => row.id);
      await manager.delete(ProjectRecentAccessEntity, { id: In(staleIds) });
    }

    return this.listProjectRecent(projectId, userId);
  }
}
