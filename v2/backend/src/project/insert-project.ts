import type { EntityManager } from "typeorm";
import { insertReturning } from "../database/dml";
import { ColumnEntity } from "../database/entities/column.entity";
import { ProjectEntity } from "../database/entities/project.entity";
import { grantProjectToRestrictedMember } from "./grant-project-to-restricted-member";
import { parsePlanningDate } from "../planning/parse-planning-date";
import {
  assertProjectKeyAvailable,
  lockProjectOrdering,
  nextProjectPosition,
} from "./project-placement";

export type NewProject = {
  workspaceId: string;
  name: string;
  icon: string;
  slug: string;
  userId: string;
  startDate?: string | null;
  endDate?: string | null;
};

export type ProjectPlacement = {
  workspaceId: string;
  projectId: string;
  slug: string;
};

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
] as const;

async function seedDefaultColumns(manager: EntityManager, projectId: string) {
  for (const column of DEFAULT_PROJECT_COLUMNS) {
    await insertReturning(manager, ColumnEntity, { projectId, ...column });
  }
}

async function finishNewProject(
  manager: EntityManager,
  project: ProjectEntity,
  { workspaceId, userId }: NewProject,
) {
  await seedDefaultColumns(manager, project.id);
  await grantProjectToRestrictedMember(manager, {
    workspaceId,
    userId,
    projectId: project.id,
  });
}

/** Creates a project at the bottom of its workspace. Run in a transaction. */
export async function insertProject(
  manager: EntityManager,
  project: NewProject,
): Promise<ProjectEntity | undefined> {
  const { workspaceId, name, icon, slug, startDate, endDate } = project;
  // Two concurrent creates would otherwise read the same max(position), and a
  // create could interleave with a reorder's renumber.
  await lockProjectOrdering(manager, workspaceId);
  await assertProjectKeyAvailable(manager, workspaceId, slug);

  const position = await nextProjectPosition(manager, workspaceId);

  const created = await insertReturning(manager, ProjectEntity, {
    workspaceId,
    name,
    icon,
    slug,
    position,
    startDate: parsePlanningDate(startDate, "startDate"),
    endDate: parsePlanningDate(endDate, "endDate"),
  });

  if (created) await finishNewProject(manager, created, project);

  return created;
}

/** Creates a project without ordering it yet; `placeProject` does that. */
export async function insertUnplacedProject(
  manager: EntityManager,
  project: NewProject,
): Promise<ProjectEntity | undefined> {
  const { workspaceId, name, icon, slug } = project;
  const created = await insertReturning(manager, ProjectEntity, {
    workspaceId,
    name,
    icon,
    slug,
    position: 0,
  });

  if (created) await finishNewProject(manager, created, project);

  return created;
}

export async function placeProject(
  manager: EntityManager,
  { workspaceId, projectId, slug }: ProjectPlacement,
) {
  await lockProjectOrdering(manager, workspaceId);
  await assertProjectKeyAvailable(manager, workspaceId, slug, projectId);
  const position = await nextProjectPosition(manager, workspaceId, projectId);

  await manager.update(ProjectEntity, { id: projectId }, { position });
}
