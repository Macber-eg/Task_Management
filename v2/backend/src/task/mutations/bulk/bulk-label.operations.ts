import { Injectable, Logger } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { deleteReturning, insertReturning } from "../../../database/dml";
import { LabelEntity } from "../../../database/entities/label.entity";
import { EventBus } from "../../../events/event-bus";
import { TaskLabelIntegrationSync } from "../../seams/task-label-integration-sync";
import type { BulkContext } from "./bulk-task";

/** Adds or removes a workspace label on many tasks. */
@Injectable()
export class BulkLabelOperations {
  private readonly logger = new Logger(BulkLabelOperations.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly integrationSync: TaskLabelIntegrationSync,
  ) {}

  async addLabel({ tasks, value, workspaceId, userId }: BulkContext) {
    const label = await this.findLabel(value);

    if (label.workspaceId && label.workspaceId !== workspaceId) {
      throw new HTTPException(400, {
        message: "Label and tasks must belong to the same workspace",
      });
    }

    let updatedCount = 0;
    const manager = this.dataSource.manager;
    for (const task of tasks) {
      const existingAssignment = await manager.findOne(LabelEntity, {
        where: { name: label.name, taskId: task.id },
        select: { id: true },
      });

      if (!existingAssignment) {
        await insertReturning(
          manager,
          LabelEntity,
          {
            name: label.name,
            color: label.color,
            workspaceId,
            taskId: task.id,
          },
          { onConflict: { target: ["taskId", "name"] } },
        );
        updatedCount++;

        await this.events.publish("task.label_assigned", {
          projectId: task.projectId,
          taskId: task.id,
          userId,
          type: "label_assigned",
        });
      }
    }
    return updatedCount;
  }

  async removeLabel({
    tasks,
    foundIds,
    value,
    workspaceId,
    userId,
  }: BulkContext) {
    const label = await this.findLabel(value);

    const deletedLabels = await deleteReturning(
      this.dataSource.manager,
      LabelEntity,
      { workspaceId, name: label.name, taskId: In(foundIds) },
    );

    for (const deletedLabel of deletedLabels) {
      if (!deletedLabel.taskId) continue;
      this.removeFromIntegrations(deletedLabel.taskId, deletedLabel.name);

      const task = tasks.find((t) => t.id === deletedLabel.taskId);
      if (!task) continue;

      await this.events.publish("task.label_unassigned", {
        label: deletedLabel,
        task,
        projectId: task.projectId,
        taskId: deletedLabel.taskId,
        userId,
        type: "label_unassigned",
      });
    }
    return deletedLabels.length;
  }

  private async findLabel(id: string | null | undefined) {
    if (!id) {
      throw new HTTPException(400, { message: "Label ID is required" });
    }
    const label = await this.dataSource.manager.findOne(LabelEntity, {
      where: { id },
    });
    if (!label) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    return label;
  }

  private removeFromIntegrations(taskId: string, name: string) {
    this.integrationSync
      .removeLabelFromGitHub(taskId, name)
      .catch((error: unknown) => {
        this.logger.error("Failed to remove label from GitHub:", error);
      });
    this.integrationSync
      .removeLabelFromGitea(taskId, name)
      .catch((error: unknown) => {
        this.logger.error("Failed to remove label from Gitea:", error);
      });
    this.integrationSync
      .removeLabelFromGitlab(taskId, name)
      .catch((error: unknown) => {
        this.logger.error("Failed to remove label from GitLab:", error);
      });
  }
}
