import type { PermissionMap } from "../access/role-permissions";
import {
  WORKSPACE_CAPABILITY_NAMES,
  type WorkspaceCapability,
  workspaceCapabilities,
} from "../permissions";

export function getMyCapabilities(
  allows: (permissions: PermissionMap) => boolean,
): Record<WorkspaceCapability, boolean> {
  const result = {} as Record<WorkspaceCapability, boolean>;
  for (const name of WORKSPACE_CAPABILITY_NAMES) {
    const permissions: PermissionMap = {};
    for (const [resource, actions] of Object.entries(
      workspaceCapabilities[name],
    )) {
      permissions[resource] = [...actions];
    }
    result[name] = allows(permissions);
  }
  return result;
}
