import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { updateReturning } from "../../database/dml";
import { WorkspaceRoleEntity } from "../../database/entities/workspace-role.entity";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { roleOutput } from "../output/role-output";
import { RoleAccessService } from "./role-access.service";
import {
  assertKnownResources,
  assertRoleNameFree,
  normalizeRoleName,
  ungrantablePermissions,
} from "./role-checks";
import { type RoleSelector, roleCondition } from "./role-selector";

export type UpdateRoleInput = RoleSelector & {
  organizationId?: string;
  data: { permission?: Record<string, string[]>; roleName?: string };
};

@Injectable()
export class RoleUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: RoleAccessService,
  ) {}

  async update(caller: OrganizationCaller, input: UpdateRoleInput) {
    const manager = this.dataSource.manager;
    const workspaceId = input.organizationId ?? activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");

    const actor = await this.access.authorize(
      caller,
      workspaceId,
      "update",
      "YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE",
    );
    const condition = roleCondition(input);
    const existing = await manager.findOne(WorkspaceRoleEntity, {
      where: { workspaceId, ...condition },
    });
    if (!existing) throw organizationError(400, "ROLE_NOT_FOUND");

    const changes: { permission?: string; role?: string } = {};
    const { permission, roleName } = input.data;
    if (permission) {
      assertKnownResources(permission);
      const missing = ungrantablePermissions(
        actor.roles,
        actor.member.role,
        permission,
      );
      if (missing.length > 0) {
        throw organizationError(403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE", {
          missingPermissions: missing,
        });
      }
      changes.permission = JSON.stringify(permission);
    }
    if (roleName) {
      const renamed = normalizeRoleName(roleName);
      await assertRoleNameFree(manager, workspaceId, renamed);
      changes.role = renamed;
    }

    await updateReturning(manager, WorkspaceRoleEntity, changes, {
      workspaceId,
      ...condition,
    });

    // Reports the row as read before the write, with the new name and
    // permission applied (its `updatedAt` is the previous one), as before.
    const before = roleOutput(existing);
    return {
      success: true,
      roleData: {
        ...before,
        role: changes.role ?? before.role,
        permission: permission ?? before.permission ?? null,
      },
    };
  }
}
