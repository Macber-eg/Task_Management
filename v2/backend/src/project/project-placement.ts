import type { EntityManager } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { findProjectKeyConflict, projectKeyTakenMessage } from "./project-key";

/**
 * Serializes a workspace's project ordering writes (create, reorder, move,
 * unarchive, key changes) for the rest of the transaction.
 */
export async function lockProjectOrdering(
  manager: EntityManager,
  workspaceId: string,
) {
  await manager.query("SELECT pg_advisory_xact_lock(1524, hashtext($1))", [
    workspaceId,
  ]);
}

export async function assertProjectKeyAvailable(
  manager: EntityManager,
  workspaceId: string,
  slug: string,
  excludeProjectId?: string,
) {
  const keyConflict = await findProjectKeyConflict(manager, workspaceId, slug, {
    excludeProjectId,
  });
  if (keyConflict) {
    throw new HTTPException(409, {
      message: projectKeyTakenMessage(slug, keyConflict.name),
    });
  }
}

/** The position after the workspace's last project. */
export async function nextProjectPosition(
  manager: EntityManager,
  workspaceId: string,
  excludeProjectId?: string,
): Promise<number> {
  const parameters = [workspaceId];
  if (excludeProjectId) parameters.push(excludeProjectId);
  const [row] = (await manager.query(
    `SELECT max(position) AS "maxPosition" FROM project
     WHERE workspace_id = $1 ${excludeProjectId ? "AND id <> $2" : ""}`,
    parameters,
  )) as { maxPosition: number | null }[];
  const maxPosition = row?.maxPosition ?? null;
  return maxPosition === null ? 0 : maxPosition + 1;
}
