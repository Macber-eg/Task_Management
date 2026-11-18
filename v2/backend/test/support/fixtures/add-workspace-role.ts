import type { EntityManager } from "typeorm";
import { WorkspaceRoleEntity } from "../../../src/database/entities/workspace-role.entity";
import { insertRow } from "./insert-row";

/** A stored role definition: a custom role, or an edited default one. */
export function addWorkspaceRole(
  db: EntityManager,
  workspaceId: string,
  role: string,
  permission: Record<string, string[]>,
): Promise<WorkspaceRoleEntity> {
  return insertRow(db, WorkspaceRoleEntity, {
    workspaceId,
    role,
    permission: JSON.stringify(permission),
  });
}
