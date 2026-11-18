import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { EventBus } from "../../../events/event-bus";
import { StorageCleanupQueue } from "../../../storage/cleanup/storage-cleanup-queue.service";
import { findTaskAssetKeys } from "../../shared/task-asset-keys";
import { getSubtaskParentProjects } from "../../shared/subtask-parent-projects";
import { type BulkContext, lockUnmovedTasks } from "./bulk-task";

@Injectable()
export class BulkDeleteOperation {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly cleanup: StorageCleanupQueue,
  ) {}

  async run(context: BulkContext): Promise<number> {
    const { tasks, foundIds, userId } = context;
    // Relations cascade away with the children, so capture parents first.
    const parentProjects = await getSubtaskParentProjects(
      this.dataSource.manager,
      foundIds,
    );
    const deletedCount = await this.dataSource.transaction(async (tx) => {
      await lockUnmovedTasks(tx, context, `id, project_id AS "projectId"`);
      await this.cleanup.queue(tx, await findTaskAssetKeys(tx, foundIds));
      const [, rowCount] = (await tx.query(
        `DELETE FROM task WHERE id = ANY($1::text[])`,
        [foundIds],
      )) as [unknown[], number | null];
      return rowCount;
    });

    for (const task of tasks) {
      await this.events.publish("task.deleted", {
        taskId: task.id,
        projectId: task.projectId,
        userId,
        title: task.title,
      });
    }
    await this.events.publish("subtask-parents.refresh", {
      projects: parentProjects,
    });
    return deletedCount ?? foundIds.length;
  }
}
