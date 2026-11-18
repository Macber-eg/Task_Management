import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";

/** Of the given projects, those the viewer may see, mapped to their workspace. */
export async function findAccessibleProjects(
  manager: EntityManager,
  viewerId: string,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();

  const rows = (await manager.query(
    `SELECT p.id, p.workspace_id AS "workspaceId" FROM project AS p
     WHERE p.id = ANY($2::text[])
       AND ${projectAccessCondition("$1", "p.id")}`,
    [viewerId, ids],
  )) as { id: string; workspaceId: string }[];
  return new Map(rows.map((row) => [row.id, row.workspaceId]));
}
