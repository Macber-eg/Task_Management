import type { EntityManager } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectEntity } from "../database/entities/project.entity";
import { ProjectPhaseEntity } from "../database/entities/project-phase.entity";
import { ProjectSprintEntity } from "../database/entities/project-sprint.entity";

export async function getProjectPlanningFlags(
  manager: EntityManager,
  projectId: string,
) {
  const project = await manager.findOne(ProjectEntity, {
    where: { id: projectId },
    select: { id: true, phasesEnabled: true, sprintsEnabled: true },
  });

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return {
    phasesEnabled: project.phasesEnabled,
    sprintsEnabled: project.sprintsEnabled,
  };
}

export async function assertPhasesEnabled(
  manager: EntityManager,
  projectId: string,
) {
  const flags = await getProjectPlanningFlags(manager, projectId);
  if (!flags.phasesEnabled) {
    throw new HTTPException(403, {
      message: "Phases are not enabled for this project",
    });
  }
}

export async function assertSprintsEnabled(
  manager: EntityManager,
  projectId: string,
) {
  const flags = await getProjectPlanningFlags(manager, projectId);
  if (!flags.sprintsEnabled) {
    throw new HTTPException(403, {
      message: "Sprints are not enabled for this project",
    });
  }
}

export async function assertPhaseInProject(
  manager: EntityManager,
  phaseId: string,
  projectId: string,
) {
  const phase = await manager.findOne(ProjectPhaseEntity, {
    where: { id: phaseId, projectId },
    select: { id: true },
  });

  if (!phase) {
    throw new HTTPException(400, {
      message: "Phase does not belong to this project",
    });
  }
}

export async function assertSprintInProject(
  manager: EntityManager,
  sprintId: string,
  projectId: string,
) {
  const sprint = await manager.findOne(ProjectSprintEntity, {
    where: { id: sprintId, projectId },
    select: { id: true },
  });

  if (!sprint) {
    throw new HTTPException(400, {
      message: "Sprint does not belong to this project",
    });
  }
}
