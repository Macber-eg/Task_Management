import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { deleteReturning } from "../database/dml";
import { AssetEntity } from "../database/entities/asset.entity";
import { ProjectEntity } from "../database/entities/project.entity";
import { EventBus } from "../events/event-bus";
import { StorageCleanupQueue } from "../storage/cleanup/storage-cleanup-queue.service";
import { ProjectQueryService } from "./project-query.service";
import { getProjectSubtaskParentProjects } from "./project-subtask-parents";

@Injectable()
export class ProjectDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly query: ProjectQueryService,
    private readonly events: EventBus,
    private readonly storageCleanup: StorageCleanupQueue,
  ) {}

  async deleteProject(id: string, workspaceId: string): Promise<ProjectEntity> {
    const existingProject = await this.query.getProject(id, workspaceId);

    const parents = await getProjectSubtaskParentProjects(
      this.dataSource.manager,
      id,
    );

    const deletedProject = await this.dataSource.transaction(async (tx) => {
      // Lock the owner before collecting keys so uploads cannot race the cascade.
      const project = await tx.findOne(ProjectEntity, {
        where: { id, workspaceId },
        lock: { mode: "pessimistic_write" },
      });
      if (!project)
        throw new HTTPException(404, { message: "Project not found" });
      const assets = await tx.find(AssetEntity, {
        where: { projectId: id },
        select: { objectKey: true },
      });
      await this.storageCleanup.queue(tx, [
        ...assets.map((asset) => asset.objectKey),
        ...(project.backgroundObjectKey ? [project.backgroundObjectKey] : []),
      ]);
      const [deleted] = await deleteReturning(tx, ProjectEntity, {
        id,
        workspaceId,
      });
      return deleted;
    });
    if (!deletedProject) {
      throw new HTTPException(500, {
        message: "Failed to delete project",
      });
    }

    await this.events.publish("subtask-parents.refresh", {
      projects: parents.filter((parent) => parent.projectId !== id),
    });

    return existingProject;
  }
}
