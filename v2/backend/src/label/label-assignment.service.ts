import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ProjectAccessService } from "../access/project-access.service";
import { HTTPException } from "../common/errors/http-exception";
import { deleteReturning, insertReturning } from "../database/dml";
import { LabelEntity } from "../database/entities/label.entity";
import { TaskEntity } from "../database/entities/task.entity";
import { EventBus } from "../events/event-bus";
import { findTaskScope } from "./find-task-scope";
import { LabelIntegrationSync } from "./label-integration-sync";

type InsertionResult = {
  taskLabel: LabelEntity;
  inserted: boolean;
  previousTaskId: string | null;
  previousName: string;
};

/** Attaches labels to tasks and detaches them. */
@Injectable()
export class LabelAssignmentService {
  private readonly logger = new Logger(LabelAssignmentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
    private readonly events: EventBus,
    private readonly integrationSync: LabelIntegrationSync,
  ) {}

  async assignLabelToTask(
    id: string,
    taskId: string,
    userId: string,
  ): Promise<LabelEntity> {
    const manager = this.dataSource.manager;
    const label = await manager.findOne(LabelEntity, { where: { id } });

    if (!label) {
      throw new HTTPException(404, {
        message: "Label not found",
      });
    }

    if (label.deletionStartedAt)
      throw new HTTPException(409, { message: "This label is being deleted" });

    const task = await findTaskScope(manager, taskId);

    if (!task) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    if (label.workspaceId && label.workspaceId !== task.workspaceId) {
      throw new HTTPException(400, {
        message: "Label and task must belong to the same workspace",
      });
    }

    await this.projectAccess.assertProjectAccess(userId, task.projectId);

    if (label.taskId === taskId) {
      return label;
    }

    const { taskLabel, inserted, previousTaskId, previousName } =
      await this.dataSource.transaction<InsertionResult>(async (tx) => {
        const currentLabel = await tx.findOne(LabelEntity, { where: { id } });

        if (!currentLabel) {
          throw new HTTPException(404, {
            message: "Label not found",
          });
        }

        if (currentLabel.deletionStartedAt)
          throw new HTTPException(409, {
            message: "This label is being deleted",
          });

        if (
          currentLabel.workspaceId &&
          currentLabel.workspaceId !== task.workspaceId
        ) {
          throw new HTTPException(400, {
            message: "Label and task must belong to the same workspace",
          });
        }

        if (currentLabel.taskId === taskId) {
          return {
            taskLabel: currentLabel,
            inserted: false,
            previousTaskId: null,
            previousName: currentLabel.name,
          };
        }

        const previousTaskId = currentLabel.taskId;
        if (previousTaskId) {
          await tx.delete(LabelEntity, { id });
        }

        const insertedRow = await insertReturning(
          tx,
          LabelEntity,
          {
            name: currentLabel.name,
            color: currentLabel.color,
            taskId,
            workspaceId: task.workspaceId,
          },
          { onConflict: { target: ["taskId", "name"] } },
        );

        if (insertedRow) {
          return {
            taskLabel: insertedRow,
            inserted: true,
            previousTaskId,
            previousName: currentLabel.name,
          };
        }

        const existing = await tx.findOne(LabelEntity, {
          where: { taskId, name: currentLabel.name },
        });

        if (!existing) {
          throw new HTTPException(500, {
            message: "Failed to attach label to task",
          });
        }

        return {
          taskLabel: existing,
          inserted: false,
          previousTaskId,
          previousName: currentLabel.name,
        };
      });

    if (previousTaskId) {
      const previousTask = await manager.findOne(TaskEntity, {
        where: { id: previousTaskId },
        select: { projectId: true },
      });
      if (previousTask)
        await this.events.publish("task.labels_updated", {
          projectId: previousTask.projectId,
          taskId: previousTaskId,
        });
      this.integrationSync
        .removeLabelFromGitHub(previousTaskId, previousName)
        .catch((error: unknown) => {
          this.logger.error("Failed to remove label from GitHub:", error);
        });
      this.integrationSync
        .removeLabelFromGitea(previousTaskId, previousName)
        .catch((error: unknown) => {
          this.logger.error("Failed to remove label from Gitea:", error);
        });
      this.integrationSync
        .removeLabelFromGitlab(previousTaskId, previousName)
        .catch((error: unknown) => {
          this.logger.error("Failed to remove label from GitLab:", error);
        });
    }

    if (!inserted) {
      return taskLabel;
    }

    this.integrationSync
      .syncLabelToGitHub(taskId, taskLabel.name, taskLabel.color)
      .catch((error: unknown) => {
        this.logger.error("Failed to sync label to GitHub:", error);
      });
    this.integrationSync
      .syncLabelToGitea(taskId, taskLabel.name, taskLabel.color)
      .catch((error: unknown) => {
        this.logger.error("Failed to sync label to Gitea:", error);
      });
    this.integrationSync
      .syncLabelToGitlab(taskId, taskLabel.name, taskLabel.color)
      .catch((error: unknown) => {
        this.logger.error("Failed to sync label to GitLab:", error);
      });

    await this.events.publish("task.label_assigned", {
      label: taskLabel,
      task,
      projectId: task.projectId,
      taskId: task.id,
      userId,
      type: "label_assigned",
    });

    return taskLabel;
  }

  async unassignLabelFromTask(
    id: string,
    userId: string,
  ): Promise<LabelEntity> {
    const manager = this.dataSource.manager;
    const label = await manager.findOne(LabelEntity, { where: { id } });

    if (!label) {
      throw new HTTPException(404, {
        message: "Label not found",
      });
    }

    if (!label.taskId) {
      throw new HTTPException(400, {
        message: "Label is not assigned to a task",
      });
    }

    const task = await findTaskScope(manager, label.taskId);

    if (!task || task.workspaceId !== label.workspaceId) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    const [deletedLabel] = await deleteReturning(manager, LabelEntity, { id });

    if (!deletedLabel) {
      throw new HTTPException(500, {
        message: "Failed to detach label from task",
      });
    }

    if (deletedLabel.taskId) {
      this.integrationSync
        .removeLabelFromGitea(deletedLabel.taskId, deletedLabel.name)
        .catch((error: unknown) => {
          this.logger.error("Failed to remove label from Gitea:", error);
        });
      this.integrationSync
        .removeLabelFromGitlab(deletedLabel.taskId, deletedLabel.name)
        .catch((error: unknown) => {
          this.logger.error("Failed to remove label from GitLab:", error);
        });
      this.integrationSync
        .removeLabelFromGitHub(deletedLabel.taskId, deletedLabel.name)
        .catch((error: unknown) => {
          this.logger.error("Failed to remove label from GitHub:", error);
        });
    }

    await this.events.publish("task.label_unassigned", {
      label: deletedLabel,
      task,
      projectId: task.projectId,
      taskId: deletedLabel.taskId,
      userId,
      type: "label_unassigned",
    });

    return deletedLabel;
  }
}
