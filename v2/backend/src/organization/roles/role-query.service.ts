import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { WorkspaceRoleEntity } from "../../database/entities/workspace-role.entity";
import { findMember } from "../lookups/find-member";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { roleOutput } from "../output/role-output";
import { OrganizationPermissionService } from "./organization-permission.service";
import { RoleAccessService } from "./role-access.service";
import type { PermissionRequest } from "./role-authorization";
import { type RoleSelector, roleCondition } from "./role-selector";

// The previous backend read at most this many roles per list.
const LIST_LIMIT = 100;

@Injectable()
export class RoleQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: RoleAccessService,
    private readonly permissions: OrganizationPermissionService,
  ) {}

  async list(caller: OrganizationCaller, organizationId: string | undefined) {
    const workspaceId = organizationId ?? activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");
    await this.access.authorize(
      caller,
      workspaceId,
      "read",
      "YOU_ARE_NOT_ALLOWED_TO_LIST_A_ROLE",
    );
    const roles = await this.dataSource.manager.find(WorkspaceRoleEntity, {
      where: { workspaceId },
      take: LIST_LIMIT,
    });
    return roles.map(roleOutput);
  }

  async get(
    caller: OrganizationCaller,
    input: RoleSelector & { organizationId?: string },
  ) {
    const workspaceId = input.organizationId ?? activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");
    await this.access.authorize(
      caller,
      workspaceId,
      "read",
      "YOU_ARE_NOT_ALLOWED_TO_READ_A_ROLE",
    );
    const role = await this.dataSource.manager.findOne(WorkspaceRoleEntity, {
      where: { workspaceId, ...roleCondition(input) },
    });
    if (!role) throw organizationError(400, "ROLE_NOT_FOUND");
    return roleOutput(role);
  }

  /** Whether the caller's role in the workspace grants every requested action. */
  async hasPermission(
    caller: OrganizationCaller,
    organizationId: string | undefined,
    permissions: PermissionRequest | undefined,
  ) {
    const workspaceId = organizationId || activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");
    const found = await findMember(
      this.dataSource.manager,
      caller.user.id,
      workspaceId,
    );
    if (!found) {
      throw organizationError(401, "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION");
    }
    const success = await this.permissions.hasPermission({
      workspaceId,
      role: found.member.role,
      permissions,
    });
    return { error: null, success };
  }
}
