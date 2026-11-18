import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ActivityEntity } from "../database/entities/activity.entity";
import { redactInaccessibleMoves } from "./redact-inaccessible-moves";

/** A task's activity feed. */
@Injectable()
export class ActivityQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async getActivities(
    taskId: string,
    viewerId: string,
    limit?: number,
  ): Promise<ActivityEntity[]> {
    const manager = this.dataSource.manager;
    const activities = await manager.find(ActivityEntity, {
      where: { taskId },
      order: { createdAt: "DESC", id: "DESC" },
      take: limit,
    });

    for (const activity of activities) {
      if (activity.content && activity.type !== "comment") {
        activity.content = activity.content.replace(/\n+/g, "\n");
      }
    }

    return redactInaccessibleMoves(manager, viewerId, activities);
  }
}
