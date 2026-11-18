import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type FindOptionsWhere, IsNull, Not, Raw } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { deleteReturning, updateReturning } from "../database/dml";
import { LabelEntity } from "../database/entities/label.entity";
import { EventBus } from "../events/event-bus";
import { findTaskScope } from "./find-task-scope";
import { LabelDeletionLock } from "./label-deletion-lock";
import { LabelIntegrationSync } from "./label-integration-sync";

export const LABEL_DELETE_BATCH_SIZE = 25;

export type DeletedLabel = LabelEntity & { pendingDeletion?: true };

@Injectable()
export class LabelDeletionService {
  private readonly logger = new Logger(LabelDeletionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lock: LabelDeletionLock,
    private readonly events: EventBus,
    private readonly integrationSync: LabelIntegrationSync,
  ) {}

  deleteLabel(id: string, userId: string): Promise<DeletedLabel> {
    const manager = this.dataSource.manager;

    return this.lock.run<DeletedLabel>(id, async () => {
      const label = await manager.findOne(LabelEntity, { where: { id } });
      if (!label) throw new HTTPException(404, { message: "Label not found" });

      if (label.taskId) {
        const task = await findTaskScope(manager, label.taskId);
        if (!task || task.workspaceId !== label.workspaceId)
          throw new HTTPException(404, { message: "Task not found" });
        const [deleted] = await deleteReturning(manager, LabelEntity, { id });
        if (!deleted)
          throw new HTTPException(404, { message: "Label not found" });
        await this.notifyDeletion(deleted, userId);
        return deleted;
      }

      // Persist the snapshot boundary before the first batch. A disconnect or
      // restart leaves this root available for the same DELETE request to resume.
      const [root] = await updateReturning(
        manager,
        LabelEntity,
        {
          // UTC like every timezone-less column, whatever the session time zone.
          deletionStartedAt: () =>
            "coalesce(deletion_started_at, timezone('UTC', clock_timestamp()))",
        },
        { id },
      );
      if (!root) throw new HTTPException(404, { message: "Label not found" });
      if (root.workspaceId) {
        await this.integrationSync.notifySyncWorkspaceLabelChanged(
          root.workspaceId,
          root.id,
        );
        const predicate: FindOptionsWhere<LabelEntity> = {
          workspaceId: root.workspaceId,
          name: root.name,
          taskId: Not(IsNull()),
          createdAt: Raw(
            (createdAt) =>
              `${createdAt} <= (select deletion_started_at from label where id = :rootLabelId)`,
            { rootLabelId: id },
          ),
        };
        const rows = await manager.find(LabelEntity, {
          where: predicate,
          select: { id: true },
          order: { createdAt: "ASC", id: "ASC" },
          take: LABEL_DELETE_BATCH_SIZE + 1,
        });
        for (const row of rows.slice(0, LABEL_DELETE_BATCH_SIZE)) {
          // Recheck the snapshot/name if a concurrent edit changed this copy.
          const [deleted] = await deleteReturning(manager, LabelEntity, {
            ...predicate,
            id: row.id,
          });
          if (deleted) await this.notifyDeletion(deleted, userId);
        }
        if (rows.length > LABEL_DELETE_BATCH_SIZE)
          return { ...root, pendingDeletion: true };
      }
      const [deleted] = await deleteReturning(manager, LabelEntity, { id });
      if (!deleted)
        throw new HTTPException(404, { message: "Label not found" });
      return deleted;
    });
  }

  private async notifyDeletion(label: LabelEntity, userId: string) {
    if (!label.taskId) return;
    const task = await findTaskScope(this.dataSource.manager, label.taskId);
    // Legacy inconsistent rows may be cleaned up, but never emit foreign events.
    if (!task || task.workspaceId !== (label.workspaceId ?? "")) return;
    const sync = this.integrationSync;
    for (const remove of [
      () => sync.removeLabelFromGitHub(task.id, label.name),
      () => sync.removeLabelFromGitea(task.id, label.name),
      () => sync.removeLabelFromGitlab(task.id, label.name),
    ]) {
      try {
        await remove();
      } catch {
        this.logger.error(
          "Failed to synchronize a label removal with an external provider",
        );
      }
    }
    await this.events.publish(
      "task.label_deleted",
      {
        label,
        task,
        projectId: task.projectId,
        taskId: task.id,
        userId,
        type: "label_deleted",
      },
      { waitForHandlers: true },
    );
  }
}
