import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import type { ApiRequest } from "../auth/principal";
import { ApiError } from "../common/errors/api-error";
import { hasInstanceAdminRole } from "./instance-admin-role";
import { missingPermissions } from "./missing-permissions";
import {
  type PermissionMap,
  rolesAllow,
  rolesMissingPermissions,
  type StoredRolePermission,
  satisfies,
} from "./role-permissions";
import { splitRoles } from "./split-roles";

type MemberRoles = { roles: string[]; stored: StoredRolePermission[] };

function apiKeyPermissions(request: ApiRequest) {
  return request.principal?.apiKey?.permissions ?? null;
}

/** Evaluates workspace permissions for the caller of a request. */
@Injectable()
export class WorkspacePermissionService {
  constructor(private readonly dataSource: DataSource) {}

  /** An API key can only ever narrow what its owner may do. */
  assertApiKeyScope(request: ApiRequest, permissions: PermissionMap): void {
    const scope = apiKeyPermissions(request);
    if (scope && !satisfies(scope, permissions)) {
      throw new ApiError(403, {
        message: "Insufficient API key scope",
        code: "API_KEY_SCOPE",
        missingPermissions: missingPermissions(scope, permissions),
      });
    }
  }

  async isInstanceAdmin(request: ApiRequest): Promise<boolean> {
    const principal = request.principal;
    if (principal?.user?.role) return hasInstanceAdminRole(principal.user.role);
    if (!principal?.userId) return false;

    const [row] = (await this.dataSource.query(
      `SELECT role FROM "user" WHERE id = $1 LIMIT 1`,
      [principal.userId],
    )) as { role: string | null }[];
    return hasInstanceAdminRole(row?.role);
  }

  async roleHasWorkspacePermission(
    workspaceId: string,
    role: string,
    permissions: PermissionMap,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<boolean> {
    const roles = splitRoles(role);
    return rolesAllow(
      roles,
      await this.storedRolePermissions(workspaceId, roles, manager),
      permissions,
    );
  }

  /**
   * `workspaceIdOverride` checks a workspace other than the one the request
   * authorized against, for requests that touch two (moving a project).
   */
  async hasWorkspacePermission(
    request: ApiRequest,
    permissions: PermissionMap,
    workspaceIdOverride?: string,
  ): Promise<boolean> {
    const workspaceId = workspaceIdOverride ?? request.workspaceId;
    if (!workspaceId) return false;

    const scope = apiKeyPermissions(request);
    if (scope && !satisfies(scope, permissions)) return false;
    if (await this.isInstanceAdmin(request)) return true;

    const { roles, stored } = await this.memberRoles(request, workspaceId);
    return rolesAllow(roles, stored, permissions);
  }

  /**
   * Same rules as `hasWorkspacePermission`, but resolves the caller's roles
   * once so many checks (the UI's capability map) cost a single lookup.
   */
  async permissionChecker(
    request: ApiRequest,
  ): Promise<(permissions: PermissionMap) => boolean> {
    const workspaceId = request.workspaceId;
    if (!workspaceId) return () => false;

    const scope = apiKeyPermissions(request);
    const isAdmin = await this.isInstanceAdmin(request);
    const { roles, stored } = isAdmin
      ? { roles: [], stored: [] }
      : await this.memberRoles(request, workspaceId);

    return (permissions) => {
      if (scope && !satisfies(scope, permissions)) return false;
      return isAdmin || rolesAllow(roles, stored, permissions);
    };
  }

  /** Throws MISSING_PERMISSION unless the caller's roles allow the action. */
  async assertMemberPermission(
    request: ApiRequest,
    workspaceId: string,
    permissions: PermissionMap,
  ): Promise<void> {
    const { roles, stored } = await this.memberRoles(request, workspaceId);
    if (!rolesAllow(roles, stored, permissions)) {
      throw new ApiError(403, {
        message: "Insufficient permissions",
        code: "MISSING_PERMISSION",
        missingPermissions: rolesMissingPermissions(roles, stored, permissions),
      });
    }
  }

  private async memberRoles(
    request: ApiRequest,
    workspaceId: string,
  ): Promise<MemberRoles> {
    const userId = request.principal?.userId;
    if (!userId) return { roles: [], stored: [] };

    const [member] = (await this.dataSource.query(
      `SELECT role FROM workspace_member
       WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [workspaceId, userId],
    )) as { role: string | null }[];

    // The stored row wins when present, so admin-edited defaults
    // (viewer/member/admin) take effect immediately. The compiled-in
    // definitions are only a fallback for a workspace that missed its seed.
    const roles = splitRoles(member?.role);
    return {
      roles,
      stored: await this.storedRolePermissions(
        workspaceId,
        roles,
        this.dataSource.manager,
      ),
    };
  }

  private async storedRolePermissions(
    workspaceId: string,
    roles: string[],
    manager: EntityManager,
  ): Promise<StoredRolePermission[]> {
    if (roles.length === 0) return [];
    return (await manager.query(
      `SELECT role, permission FROM workspace_role
       WHERE workspace_id = $1 AND role = ANY($2::text[])`,
      [workspaceId, roles],
    )) as StoredRolePermission[];
  }
}
