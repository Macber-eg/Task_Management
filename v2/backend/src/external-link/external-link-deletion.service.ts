import { Injectable } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ExternalLinkEntity } from "../database/entities/external-link.entity";
import { TaskEntity } from "../database/entities/task.entity";
import { EventBus } from "../events/event-bus";

/** Removes manual resource links; integration-managed links stay. */
@Injectable()
export class ExternalLinkDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async deleteExternalLink({
    taskId,
    id,
    userId,
  }: {
    taskId: string;
    id: string;
    userId: string;
  }): Promise<{ id: string }> {
    const manager = this.dataSource.manager;
    const task = await manager.findOne(TaskEntity, {
      where: { id: taskId },
      select: { projectId: true, title: true, status: true },
    });
    if (!task) throw new HTTPException(404, { message: "Task not found" });

    // Bind deletion to the authorized task and leave provider-managed links intact.
    const result = await manager
      .createQueryBuilder()
      .delete()
      .from(ExternalLinkEntity)
      .where({
        id,
        taskId,
        integrationId: IsNull(),
        resourceType: "url",
      })
      .returning("id")
      .execute();
    const [deleted] = result.raw as { id: string }[];
    if (!deleted)
      throw new HTTPException(404, {
        message: "Manual resource link not found",
      });

    await this.events.publish("task.updated", {
      taskId,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      userId,
    });
    return deleted;
  }
}
