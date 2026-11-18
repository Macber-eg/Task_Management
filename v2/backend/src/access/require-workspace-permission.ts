import type { AccessRule } from "./access-rule";
import { ApiKeyScopeHandler } from "./api-key-scope.handler";
import type { PermissionMap } from "./role-permissions";
import { WorkspacePermissionHandler } from "./workspace-permission.handler";

export function requireWorkspacePermission(
  permissions: PermissionMap,
): AccessRule<PermissionMap> {
  return { handler: WorkspacePermissionHandler, options: permissions };
}

export function requireApiKeyScope(
  permissions: PermissionMap,
): AccessRule<PermissionMap> {
  return { handler: ApiKeyScopeHandler, options: permissions };
}
