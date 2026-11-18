import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { ProjectEntity } from "../database/entities/project.entity";
import { parsePlanningDate } from "../planning/parse-planning-date";
import {
  findProjectKeyConflict,
  isSameProjectKey,
  projectKeyTakenMessage,
} from "./project-key";
import { lockProjectOrdering } from "./project-placement";

export type ProjectChanges = {
  name: string;
  icon: string;
  slug: string;
  description: string;
  isPublic: boolean;
  phasesEnabled: boolean;
  sprintsEnabled: boolean;
  startDate?: string | null;
  endDate?: string | null;
};

const NOT_IN_WORKSPACE =
  "Project doesn't exist or doesn't belong to the specified workspace";

function lockProjectRow(
  manager: EntityManager,
  id: string,
  workspaceId: string,
) {
  return manager.findOne(ProjectEntity, {
    where: { id, workspaceId },
    lock: { mode: "pessimistic_write" },
  });
}

/** Edits a project's settings and archived state. */
@Injectable()
export class ProjectUpdateService {
  constructor(private readonly dataSource: DataSource) {}

  updateProject(
    id: string,
    workspaceId: string,
    changes: ProjectChanges,
    canShare: boolean,
  ): Promise<ProjectEntity | undefined> {
    return this.dataSource.transaction(async (tx) => {
      await lockProjectOrdering(tx, workspaceId);

      const existingProject = await lockProjectRow(tx, id, workspaceId);

      if (!existingProject) {
        throw new HTTPException(404, { message: NOT_IN_WORKSPACE });
      }

      if (changes.isPublic !== existingProject.isPublic && !canShare) {
        throw new HTTPException(403, {
          message:
            "Changing project visibility requires the project:share permission",
        });
      }

      if (!isSameProjectKey(changes.slug, existingProject.slug)) {
        const keyConflict = await findProjectKeyConflict(
          tx,
          workspaceId,
          changes.slug,
          { excludeProjectId: id },
        );
        if (keyConflict) {
          throw new HTTPException(409, {
            message: projectKeyTakenMessage(changes.slug, keyConflict.name),
          });
        }
      }

      const [updatedProject] = await updateReturning(
        tx,
        ProjectEntity,
        {
          name: changes.name,
          icon: changes.icon,
          slug: changes.slug,
          description: changes.description,
          isPublic: changes.isPublic,
          phasesEnabled: changes.phasesEnabled,
          sprintsEnabled: changes.sprintsEnabled,
          startDate: parsePlanningDate(changes.startDate, "startDate"),
          endDate: parsePlanningDate(changes.endDate, "endDate"),
        },
        { id },
      );

      return updatedProject;
    });
  }

  async archiveProject(
    id: string,
    workspaceId: string,
  ): Promise<ProjectEntity> {
    const manager = this.dataSource.manager;
    const existingProject = await manager.findOne(ProjectEntity, {
      where: { id, workspaceId },
    });

    if (!existingProject) {
      throw new HTTPException(404, { message: NOT_IN_WORKSPACE });
    }

    const [archivedProject] = await updateReturning(
      manager,
      ProjectEntity,
      { archivedAt: new Date() },
      { id },
    );

    if (!archivedProject) {
      throw new HTTPException(500, {
        message: "Failed to archive project",
      });
    }

    return archivedProject;
  }

  unarchiveProject(id: string, workspaceId: string): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (tx) => {
      await lockProjectOrdering(tx, workspaceId);

      const existingProject = await lockProjectRow(tx, id, workspaceId);

      if (!existingProject) {
        throw new HTTPException(404, { message: NOT_IN_WORKSPACE });
      }

      const keyConflict = await findProjectKeyConflict(
        tx,
        workspaceId,
        existingProject.slug,
        { excludeProjectId: id },
      );
      if (keyConflict) {
        throw new HTTPException(409, {
          message: `This workspace already has a project using the key "${existingProject.slug}" (${keyConflict.name}). Change one of the keys before unarchiving this project.`,
        });
      }

      const [unarchivedProject] = await updateReturning(
        tx,
        ProjectEntity,
        { archivedAt: null },
        { id },
      );

      if (!unarchivedProject) {
        throw new HTTPException(500, {
          message: "Failed to unarchive project",
        });
      }

      return unarchivedProject;
    });
  }
}
