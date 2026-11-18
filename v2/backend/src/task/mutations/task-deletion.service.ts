import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import { TaskDetailService } from "../queries/task-detail.service";
import { StorageCleanupQueue } from "../../storage/cleanup/storage-cleanup-queue.service";
import { findTaskAssetKeys } from "../shared/task-asset-keys";

/** Deletes a task with everything that cascades from it. */
@Injectable()
export class TaskDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly detail: TaskDetailService,
    private readonly cleanup: StorageCleanupQueue,
  ) {}

  async deleteTask(taskId: string, currentUserId: string) {
    const task = await this.detail.getTask(taskId);

    const relations = (await this.dataSource.query(
      `SELECT source_task_id AS "sourceTaskId", target_task_id AS "targetTaskId"
       FROM task_relation WHERE source_task_id = $1 OR target_task_id = $1`,
      [taskId],
    )) as { sourceTaskId: string; targetTaskId: string }[];

    const deleted = await this.dataSource.transaction(async (tx) => {
      const [locked] = (await tx.query(
        `SELECT id, project_id AS "projectId" FROM task WHERE id = $1 FOR UPDATE`,
        [taskId],
      )) as { id: string; projectId: string }[];
      if (!locked) throw new HTTPException(404, { message: "Task not found" });
      if (locked.projectId !== task.projectId)
        throw new HTTPException(409, {
          message: "Task changed projects; retry the operation",
        });
      await this.cleanup.queue(tx, await findTaskAssetKeys(tx, [taskId]));
      const [rows] = (await tx.query(
        `DELETE FROM task WHERE id = $1 RETURNING id`,
        [taskId],
      )) as [{ id: string }[], number];
      return rows[0];
    });

    if (!deleted) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    await this.events.publish("task.deleted", {
      taskId: task.id,
      projectId: task.projectId,
      userId: currentUserId,
      title: task.title,
    });

    for (const relation of relations) {
      await this.events.publish("task-relation.deleted", {
        projectId: task.projectId,
        userId: currentUserId,
        taskId,
        sourceTaskId: relation.sourceTaskId,
        targetTaskId: relation.targetTaskId,
      });
    }

    return task;
  }
}
