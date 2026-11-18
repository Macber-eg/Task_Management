import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";

export async function listAccessibleProjectIds(
  manager: EntityManager,
  workspaceId: string,
  userId: string,
): Promise<Set<string>> {
  const rows = (await manager.query(
    `SELECT p.id FROM project AS p
     WHERE p.workspace_id = $1
       AND ${projectAccessCondition("$2", "p.id")}`,
    [workspaceId, userId],
  )) as { id: string }[];
  return new Set(rows.map((row) => row.id));
}
