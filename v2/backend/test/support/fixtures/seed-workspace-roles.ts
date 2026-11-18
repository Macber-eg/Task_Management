import type { EntityManager } from "typeorm";
import { WorkspaceRoleEntity } from "../../../src/database/entities/workspace-role.entity";
import {
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
} from "../../../src/permissions";
import { insertRow } from "./insert-row";

/** The editable default roles every real workspace is created with. */
export async function seedWorkspaceRoles(
  db: EntityManager,
  workspaceId: string,
): Promise<void> {
  for (const role of DEFAULT_ROLE_NAMES) {
    await insertRow(db, WorkspaceRoleEntity, {
      workspaceId,
      role,
      permission: JSON.stringify(defaultRolePayloads[role]),
    });
  }
}
