import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import type { OrganizationCaller } from "../organization-caller.service";
import { type OrganizationErrorCode, organizationError } from "../organization-error";
import { OrganizationPermissionService } from "./organization-permission.service";
import { rolesAuthorize, type Statements } from "./role-authorization";

export type RoleActor = {
  member: WorkspaceUserEntity;
  roles: Map<string, Statements>;
};

/** Who may manage a workspace's roles: members whose role grants the `ac` action. */
@Injectable()
export class RoleAccessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: OrganizationPermissionService,
  ) {}

  async authorize(
    caller: OrganizationCaller,
    workspaceId: string,
    action: "create" | "read" | "update" | "delete",
    deniedCode: OrganizationErrorCode,
  ): Promise<RoleActor> {
    const member = await this.dataSource.manager.findOne(WorkspaceUserEntity, {
      where: { workspaceId, userId: caller.user.id },
    });
    if (!member) {
      throw organizationError(403, "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION");
    }
    const roles = await this.permissions.roleStatements(workspaceId);
    if (!rolesAuthorize(roles, member.role, { ac: [action] })) {
      throw organizationError(403, deniedCode);
    }
    return { member, roles };
  }
}
