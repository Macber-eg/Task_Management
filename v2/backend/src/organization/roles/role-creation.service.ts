import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning } from "../../database/dml";
import { WorkspaceRoleEntity } from "../../database/entities/workspace-role.entity";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { roleOutput } from "../output/role-output";
import { RoleAccessService } from "./role-access.service";
import { CREATOR_ROLE } from "./role-authorization";
import {
  assertKnownResources,
  assertRoleNameFree,
  normalizeRoleName,
  ungrantablePermissions,
} from "./role-checks";

const MAXIMUM_ROLES_PER_WORKSPACE = 25;

export type CreateRoleInput = {
  organizationId?: string;
  role: string;
  permission: Record<string, string[]>;
};

@Injectable()
export class RoleCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: RoleAccessService,
  ) {}

  async create(caller: OrganizationCaller, input: CreateRoleInput) {
    const manager = this.dataSource.manager;
    const workspaceId = input.organizationId ?? activeOrganizationOf(caller);
    if (!workspaceId) {
      throw organizationError(
        400,
        "YOU_MUST_BE_IN_AN_ORGANIZATION_TO_CREATE_A_ROLE",
      );
    }
    const role = normalizeRoleName(input.role);
    if (role === CREATOR_ROLE) {
      throw organizationError(400, "ROLE_NAME_IS_ALREADY_TAKEN");
    }

    const actor = await this.access.authorize(
      caller,
      workspaceId,
      "create",
      "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE",
    );
    const stored = await manager.count(WorkspaceRoleEntity, {
      where: { workspaceId },
    });
    if (stored >= MAXIMUM_ROLES_PER_WORKSPACE) {
      throw organizationError(400, "TOO_MANY_ROLES");
    }
    assertKnownResources(input.permission);
    const missing = ungrantablePermissions(
      actor.roles,
      actor.member.role,
      input.permission,
    );
    if (missing.length > 0) {
      throw organizationError(403, "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE", {
        missingPermissions: missing,
      });
    }
    await assertRoleNameFree(manager, workspaceId, role);

    const created = await insertReturning(manager, WorkspaceRoleEntity, {
      workspaceId,
      role,
      permission: JSON.stringify(input.permission),
      createdAt: new Date(),
    });
    if (!created) throw new Error("Failed to create role");
    return {
      success: true,
      roleData: roleOutput(created),
      statements: input.permission,
    };
  }
}
