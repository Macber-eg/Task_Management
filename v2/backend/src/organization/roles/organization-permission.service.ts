import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import {
  type PermissionRequest,
  rolesAuthorize,
  type StoredRole,
  type Statements,
  workspaceRoleStatements,
} from "./role-authorization";

/** Permission checks of the workspace endpoints, by the workspace's stored roles. */
@Injectable()
export class OrganizationPermissionService {
  constructor(private readonly dataSource: DataSource) {}

  async roleStatements(
    workspaceId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, Statements>> {
    const stored = (await manager.query(
      "SELECT role, permission FROM workspace_role WHERE workspace_id = $1",
      [workspaceId],
    )) as StoredRole[];
    return workspaceRoleStatements(stored);
  }

  async hasPermission(check: {
    workspaceId: string;
    role: string;
    permissions: PermissionRequest | undefined;
    allowCreatorAllPermissions?: boolean;
  }): Promise<boolean> {
    return rolesAuthorize(
      await this.roleStatements(check.workspaceId),
      check.role,
      check.permissions,
      check.allowCreatorAllPermissions,
    );
  }
}
