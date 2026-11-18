import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { DEFAULT_ROLE_NAMES, defaultRolePayloads } from "../../permissions";

/**
 * Inserts the editable default roles (viewer, member, admin) each workspace
 * is missing; names already stored are left alone. Returns how many rows
 * were written.
 */
export async function seedDefaultRoles(
  manager: EntityManager,
  workspaceIds: readonly string[],
): Promise<number> {
  if (workspaceIds.length === 0) return 0;

  const existing = (await manager.query(
    `SELECT workspace_id AS "workspaceId", role FROM workspace_role
     WHERE workspace_id = ANY($1::text[]) AND role = ANY($2::text[])`,
    [workspaceIds, DEFAULT_ROLE_NAMES],
  )) as { workspaceId: string; role: string }[];
  const present = new Set(existing.map((row) => `${row.workspaceId}:${row.role}`));

  const rows = workspaceIds.flatMap((workspaceId) =>
    DEFAULT_ROLE_NAMES.filter(
      (role) => !present.has(`${workspaceId}:${role}`),
    ).map((role) => ({ workspaceId, role })),
  );
  if (rows.length === 0) return 0;

  await manager.query(
    `INSERT INTO workspace_role (id, workspace_id, role, permission)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])`,
    [
      rows.map(() => createId()),
      rows.map((row) => row.workspaceId),
      rows.map((row) => row.role),
      rows.map((row) => JSON.stringify(defaultRolePayloads[row.role])),
    ],
  );
  return rows.length;
}
