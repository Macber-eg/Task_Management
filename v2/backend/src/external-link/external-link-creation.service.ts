import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { ExternalLinkEntity } from "../database/entities/external-link.entity";
import { EventBus } from "../events/event-bus";

export type NewExternalLink = {
  taskId: string;
  url: string;
  title?: string;
  userId: string;
};

/** Adds manual resource links to tasks. */
@Injectable()
export class ExternalLinkCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async createExternalLink({
    taskId,
    url,
    title,
    userId,
  }: NewExternalLink): Promise<ExternalLinkEntity> {
    const manager = this.dataSource.manager;
    const link = await insertReturning(manager, ExternalLinkEntity, {
      taskId,
      integrationId: null,
      resourceType: "url",
      externalId: url,
      url,
      title: title ?? null,
    });

    if (!link) {
      throw new HTTPException(500, {
        message: "Failed to create external link",
      });
    }

    const [task] = (await manager.query(
      `SELECT t.project_id AS "projectId", t.title, t.status
       FROM task AS t
       INNER JOIN project AS p ON t.project_id = p.id
       WHERE t.id = $1
       LIMIT 1`,
      [taskId],
    )) as { projectId: string; title: string; status: string }[];

    if (!task) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    await this.events.publish("task.updated", {
      taskId,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      userId,
    });

    return link;
  }
}
