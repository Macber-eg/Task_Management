import { Injectable, Logger } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { ProjectAccessService } from "../access/project-access.service";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { LabelEntity } from "../database/entities/label.entity";
import { EventBus } from "../events/event-bus";
import { findTaskScope } from "./find-task-scope";
import { LabelIntegrationSync } from "./label-integration-sync";

@Injectable()
export class LabelCreationService {
  private readonly logger = new Logger(LabelCreationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
    private readonly events: EventBus,
    private readonly integrationSync: LabelIntegrationSync,
  ) {}

  async createLabel(
    name: string,
    color: string,
    taskId: string | undefined,
    workspaceId: string,
    userId: string,
  ): Promise<LabelEntity> {
    const manager = this.dataSource.manager;

    const deleting = await manager.findOne(LabelEntity, {
      where: { workspaceId, name, taskId: IsNull() },
    });
    if (deleting?.deletionStartedAt)
      throw new HTTPException(409, { message: "This label is being deleted" });

    if (taskId) {
      const task = await findTaskScope(manager, taskId);

      if (!task) {
        throw new HTTPException(404, {
          message: "Task not found",
        });
      }

      if (task.workspaceId !== workspaceId) {
        throw new HTTPException(404, {
          message: "Task not found",
        });
      }

      await this.projectAccess.assertProjectAccess(userId, task.projectId);

      const inserted = await insertReturning(
        manager,
        LabelEntity,
        { name, color, taskId, workspaceId: task.workspaceId },
        { onConflict: { target: ["taskId", "name"] } },
      );

      const label =
        inserted ??
        (await manager.findOne(LabelEntity, { where: { taskId, name } }));

      if (!label) {
        throw new Error("Failed to create or resolve label");
      }

      if (inserted) {
        this.integrationSync
          .syncLabelToGitHub(taskId, name, color)
          .catch((error: unknown) => {
            this.logger.error("Failed to sync label to GitHub:", error);
          });
        this.integrationSync
          .syncLabelToGitea(taskId, name, color)
          .catch((error: unknown) => {
            this.logger.error("Failed to sync label to Gitea:", error);
          });
        this.integrationSync
          .syncLabelToGitlab(taskId, name, color)
          .catch((error: unknown) => {
            this.logger.error("Failed to sync label to GitLab:", error);
          });

        await this.events.publish("task.label_created", {
          projectId: task.projectId,
          taskId: task.id,
          userId: userId,
          type: "label_created",
        });
      }
      return label;
    }

    const inserted = await insertReturning(
      manager,
      LabelEntity,
      { name, color, taskId: null, workspaceId },
      {
        onConflict: {
          target: ["workspaceId", "name"],
          where: "task_id is null",
        },
      },
    );

    const label =
      inserted ??
      (await manager.findOne(LabelEntity, {
        where: { workspaceId, name, taskId: IsNull() },
      }));

    if (!label) {
      throw new Error("Failed to create or resolve label");
    }

    return label;
  }
}
