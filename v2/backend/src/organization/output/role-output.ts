import type { WorkspaceRoleEntity } from "../../database/entities/workspace-role.entity";

/** A stored role with its permission JSON parsed. */
export function roleOutput(role: WorkspaceRoleEntity) {
  return {
    id: role.id,
    organizationId: role.workspaceId,
    role: role.role,
    permission: JSON.parse(role.permission) as Record<string, string[]>,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
