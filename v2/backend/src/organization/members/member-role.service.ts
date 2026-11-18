import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { updateReturning } from "../../database/dml";
import { UserEntity } from "../../database/entities/user.entity";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { isOwnerRole } from "../../project-access/is-owner-role";
import { WorkspaceMemberLifecycleService } from "../../workspace-members/workspace-member-lifecycle.service";
import { countOwners, hasOwnerRole } from "../lookups/count-owners";
import { findMember, findMemberById } from "../lookups/find-member";
import { findWorkspaceById } from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { memberOutput } from "../output/member-output";
import { findUnknownRoles } from "../roles/find-unknown-roles";
import { OrganizationPermissionService } from "../roles/organization-permission.service";
import { CREATOR_ROLE } from "../roles/role-authorization";

export type MemberRoleChange = {
  role: string | string[];
  memberId: string;
  organizationId?: string;
};

@Injectable()
export class MemberRoleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: OrganizationPermissionService,
    private readonly lifecycle: WorkspaceMemberLifecycleService,
  ) {}

  async updateRole(caller: OrganizationCaller, change: MemberRoleChange) {
    const manager = this.dataSource.manager;
    if (!change.role) throw new HTTPException(400);
    const workspaceId = change.organizationId || activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");

    const rolesToSet = (Array.isArray(change.role) ? change.role : [change.role])
      .flatMap((role) => role.split(","))
      .map((role) => role.trim())
      .filter(Boolean);
    if (rolesToSet.length === 0) throw new HTTPException(400);
    const unknown = await findUnknownRoles(manager, workspaceId, rolesToSet);
    if (unknown.length > 0) {
      throw organizationError(400, "ROLE_NOT_FOUND", {
        message: `ROLE_NOT_FOUND: ${unknown.join(", ")}`,
      });
    }

    const actor = await findMember(manager, caller.user.id, workspaceId);
    if (!actor) throw organizationError(400, "MEMBER_NOT_FOUND");
    const target =
      actor.member.id === change.memberId
        ? actor.member
        : (await findMemberById(manager, change.memberId))?.member;
    if (!target) throw organizationError(400, "MEMBER_NOT_FOUND");
    if (target.workspaceId !== workspaceId) {
      throw organizationError(403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER");
    }

    const actorIsCreator = hasOwnerRole(actor.member.role);
    const settingCreator = rolesToSet.includes(CREATOR_ROLE);
    if ((hasOwnerRole(target.role) || settingCreator) && !actorIsCreator) {
      throw organizationError(403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER");
    }
    if (
      actorIsCreator &&
      actor.member.id === target.id &&
      !settingCreator &&
      (await countOwners(manager, workspaceId)) <= 1
    ) {
      throw organizationError(
        400,
        "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
      );
    }

    const allowed = await this.permissions.hasPermission({
      workspaceId,
      role: actor.member.role,
      permissions: { member: ["update"] },
      allowCreatorAllPermissions: true,
    });
    if (!allowed) {
      throw organizationError(403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER");
    }
    if (!(await findWorkspaceById(manager, workspaceId))) {
      throw organizationError(400, "ORGANIZATION_NOT_FOUND");
    }
    const user = await manager.findOne(UserEntity, {
      where: { id: target.userId },
    });
    if (!user) throw new HTTPException(400, { message: "User not found" });

    const [updated] = await updateReturning(
      manager,
      WorkspaceUserEntity,
      { role: rolesToSet.join(",") },
      { id: change.memberId },
    );
    if (!updated) throw organizationError(400, "MEMBER_NOT_FOUND");

    if (isOwnerRole(updated.role)) {
      await this.lifecycle.handleOwnerPromoted(
        updated.workspaceId,
        updated.userId,
      );
    }
    return memberOutput(updated);
  }
}
