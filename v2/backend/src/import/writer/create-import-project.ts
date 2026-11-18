import type { DataSource, EntityManager } from "typeorm";
import type { ProjectEntity } from "../../database/entities/project.entity";
import {
  insertUnplacedProject,
  placeProject,
} from "../../project/insert-project";
import { createWithUniqueKey } from "./create-with-unique-key";

export type ImportProjectInput = {
  workspaceId: string;
  name: string;
  userId: string;
  preferredKey?: string;
};

/**
 * Creates the project and fills it in one transaction, so a failed import
 * leaves nothing behind; a key another create took meanwhile retries the
 * whole transaction with the next free key.
 */
export async function createImportProject<T>(
  dataSource: DataSource,
  { workspaceId, name, userId, preferredKey }: ImportProjectInput,
  fill: (tx: EntityManager, project: ProjectEntity) => Promise<T>,
): Promise<T> {
  const existing = (await dataSource.query(
    "SELECT slug FROM project WHERE workspace_id = $1",
    [workspaceId],
  )) as { slug: string }[];

  return createWithUniqueKey(
    name,
    existing.map((row) => row.slug),
    (slug) =>
      dataSource.transaction(async (tx) => {
        const project = await insertUnplacedProject(tx, {
          workspaceId,
          name,
          icon: "Layout",
          slug,
          userId,
        });
        if (!project) throw new Error("Failed to create the imported project");
        const result = await fill(tx, project);
        await placeProject(tx, { workspaceId, projectId: project.id, slug });
        return result;
      }),
    { preferredKey },
  );
}
