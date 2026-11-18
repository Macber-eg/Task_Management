import { Injectable } from "@nestjs/common";
import { DataSource, IsNull, Not } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { LabelEntity } from "../database/entities/label.entity";
import { ProjectEntity } from "../database/entities/project.entity";
import { TaskEntity } from "../database/entities/task.entity";
import { EventBus } from "../events/event-bus";
import { LabelIntegrationSync } from "./label-integration-sync";

@Injectable()
export class LabelUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly integrationSync: LabelIntegrationSync,
  ) {}

  async updateLabel(
    id: string,
    name: string,
    color: string,
  ): Promise<LabelEntity> {
    const result = await this.dataSource.transaction(async (tx) => {
      const label = await tx.findOne(LabelEntity, { where: { id } });

      if (!label) {
        throw new HTTPException(404, {
          message: "Label not found",
        });
      }

      if (label.deletionStartedAt)
        throw new HTTPException(409, {
          message: "This label is being deleted; resume its deletion instead",
        });

      const [updatedLabel] = await updateReturning(
        tx,
        LabelEntity,
        { name, color },
        { id, deletionStartedAt: IsNull() },
      );

      if (!updatedLabel)
        throw new HTTPException(409, {
          message: "This label is being deleted",
        });

      // If this is a workspace-level label, cascade the changes to all
      // task-level copies so existing label assignments reflect the new color/name
      if (!label.taskId && label.workspaceId) {
        await tx.update(
          LabelEntity,
          {
            workspaceId: label.workspaceId,
            name: label.name,
            taskId: Not(IsNull()),
          },
          // Stamped from the application clock like every other write;
          // left out, TypeORM would use the database's CURRENT_TIMESTAMP.
          { name, color, updatedAt: new Date() },
        );
      }

      // Workspace labels appear in every board's choices, including unassigned
      // labels. Publish only project IDs within this workspace after commit.
      const projects: { projectId: string }[] =
        !label.taskId && label.workspaceId
          ? (
              await tx.find(ProjectEntity, {
                where: { workspaceId: label.workspaceId },
                select: { id: true },
              })
            ).map((project) => ({ projectId: project.id }))
          : await tx
              .createQueryBuilder(LabelEntity, "label")
              .select("task.projectId", "projectId")
              .distinct(true)
              .innerJoin(TaskEntity, "task", "label.taskId = task.id")
              .innerJoin(
                ProjectEntity,
                "project",
                "task.projectId = project.id",
              )
              .where(
                label.taskId
                  ? "label.id = :id"
                  : "(label.workspaceId = :workspaceId AND label.name = :name)",
                { id, workspaceId: label.workspaceId ?? "", name },
              )
              .andWhere("project.workspaceId = :workspaceId", {
                workspaceId: label.workspaceId ?? "",
              })
              .getRawMany<{ projectId: string }>();
      return { updatedLabel, projects, original: label };
    });
    for (const { projectId } of result.projects) {
      await this.events.publish("project.updated", { projectId });
    }
    if (result.original.name !== name) {
      if (!result.original.taskId && result.original.workspaceId)
        await this.integrationSync.notifySyncWorkspaceLabelChanged(
          result.original.workspaceId,
          id,
          { publishProjectUpdates: false },
        );
      else if (result.original.taskId)
        for (const { projectId } of result.projects)
          await this.events.publish("task.labels_updated", {
            projectId,
            taskId: result.original.taskId,
          });
    }
    return result.updatedLabel;
  }
}
