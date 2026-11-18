import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { WorkspaceRoleEntity } from "../../database/entities/workspace-role.entity";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { RoleAccessService } from "./role-access.service";
import { CREATOR_ROLE } from "./role-authorization";
import { type RoleSelector, roleCondition } from "./role-selector";

@Injectable()
export class RoleDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: RoleAccessService,
  ) {}

  async delete(
    caller: OrganizationCaller,
    input: RoleSelector & { organizationId?: string },
  ) {
    const manager = this.dataSource.manager;
    const workspaceId = input.organizationId ?? activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");

    await this.access.authorize(
      caller,
      workspaceId,
      "delete",
      "YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE",
    );
    if (input.roleName === CREATOR_ROLE) {
      throw organizationError(400, "CANNOT_DELETE_A_PRE_DEFINED_ROLE");
    }
    const condition = roleCondition(input);
    const existing = await manager.findOne(WorkspaceRoleEntity, {
      where: { workspaceId, ...condition },
    });
    if (!existing) throw organizationError(400, "ROLE_NOT_FOUND");

    const assigned = (await manager.query(
      `SELECT 1 FROM workspace_member AS m,
         unnest(string_to_array(m.role, ',')) AS assigned(name)
       WHERE m.workspace_id = $1 AND trim(assigned.name) = $2
       LIMIT 1`,
      [workspaceId, existing.role],
    )) as unknown[];
    if (assigned.length > 0) {
      throw organizationError(400, "ROLE_IS_ASSIGNED_TO_MEMBERS");
    }

    await manager.delete(WorkspaceRoleEntity, { workspaceId, ...condition });
    return { success: true };
  }
}
