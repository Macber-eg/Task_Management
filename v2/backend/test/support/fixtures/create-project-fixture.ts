import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { ColumnEntity } from "../../../src/database/entities/column.entity";
import { ProjectEntity } from "../../../src/database/entities/project.entity";
import { insertRow } from "./insert-row";

// The columns the API seeds for a new project.
const DEFAULT_PROJECT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
] as const;

/** A project with its default board columns. */
export async function createProjectFixture(
  db: EntityManager,
  {
    workspaceId,
    name = "Integration Project",
    icon = "Folder",
    slug = `project-${randomUUID()}`,
  }: {
    workspaceId: string;
    name?: string;
    icon?: string;
    slug?: string;
  },
) {
  const project = await insertRow(db, ProjectEntity, {
    workspaceId,
    name,
    icon,
    slug,
  });

  const columnsBySlug = new Map<string, ColumnEntity>();
  for (const column of DEFAULT_PROJECT_COLUMNS) {
    columnsBySlug.set(
      column.slug,
      await insertRow(db, ColumnEntity, { projectId: project.id, ...column }),
    );
  }

  const todo = columnsBySlug.get("to-do");
  const inProgress = columnsBySlug.get("in-progress");
  const inReview = columnsBySlug.get("in-review");
  const done = columnsBySlug.get("done");

  if (!todo || !inProgress || !inReview || !done) {
    throw new Error("Failed to seed default project columns");
  }

  return { project, columns: { todo, inProgress, inReview, done } };
}
