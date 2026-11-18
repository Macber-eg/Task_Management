import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, In, IsNull } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { deleteReturning, insertReturning } from "../database/dml";
import { CalendarFeedEntity } from "../database/entities/calendar-feed.entity";
import { LabelEntity } from "../database/entities/label.entity";

/** Creating, listing and revoking a project's secret calendar links. */
@Injectable()
export class CalendarFeedService {
  constructor(private readonly dataSource: DataSource) {}

  createCalendarFeed(
    projectId: string,
    workspaceId: string,
    labelIds: string[],
    timeZone: string,
    canCreateLabels: boolean,
  ): Promise<CalendarFeedEntity | undefined> {
    return this.dataSource.transaction(async (tx) => {
      const ids = [...new Set(labelIds)];
      const labels = ids.length
        ? await tx.find(LabelEntity, {
            where: {
              workspaceId,
              id: In(ids),
              deletionStartedAt: IsNull(),
            },
            select: { id: true, name: true, color: true },
          })
        : [];
      if (labels.length !== ids.length) {
        throw new HTTPException(400, {
          message: "Select labels from this workspace",
        });
      }
      // Task assignments are disposable. Older workspaces may have no
      // definition, so materialize one and tie subscriptions to that row.
      const definitions = [
        ...new Map(labels.map((label) => [label.name, label])).values(),
      ].sort((a, b) => a.name.localeCompare(b.name));
      if (canCreateLabels) {
        for (const { name, color } of definitions) {
          await insertReturning(
            tx,
            LabelEntity,
            { name, color, workspaceId, taskId: null },
            {
              onConflict: {
                target: ["workspaceId", "name"],
                where: "task_id is null",
              },
            },
          );
        }
      }
      const roots = definitions.length
        ? await tx.find(LabelEntity, {
            where: {
              workspaceId,
              name: In(definitions.map((label) => label.name)),
              taskId: IsNull(),
              deletionStartedAt: IsNull(),
            },
            select: { id: true },
            order: { name: "ASC" },
          })
        : [];
      if (roots.length !== definitions.length) {
        if (!canCreateLabels) {
          throw new HTTPException(403, {
            message:
              "Creating a workspace label definition requires label:create permission",
          });
        }
        throw new HTTPException(400, {
          message: "Select labels that are not being deleted",
        });
      }
      return insertReturning(tx, CalendarFeedEntity, {
        projectId,
        labelIds: roots.map((label) => label.id),
        timeZone,
        token: randomBytes(32).toString("hex"),
      });
    });
  }

  listCalendarFeeds(projectId: string): Promise<CalendarFeedEntity[]> {
    return this.dataSource.manager.find(CalendarFeedEntity, {
      where: { projectId },
      order: { createdAt: "ASC", id: "ASC" },
    });
  }

  async revokeCalendarFeed(projectId: string, id: string) {
    const [feed] = await deleteReturning(
      this.dataSource.manager,
      CalendarFeedEntity,
      { projectId, id },
    );
    if (!feed)
      throw new HTTPException(404, { message: "Calendar feed not found" });
    return { success: true };
  }
}
