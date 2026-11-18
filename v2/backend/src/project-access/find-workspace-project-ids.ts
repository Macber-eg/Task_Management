import type { EntityManager } from "typeorm";

/** The given project ids that belong to the workspace. */
export async function findWorkspaceProjectIds(
  manager: EntityManager,
  workspaceId: string,
  projectIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return [];

  const rows = (await manager.query(
    `SELECT id FROM project
     WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [workspaceId, ids],
  )) as { id: string }[];

  return rows.map((row) => row.id);
}
