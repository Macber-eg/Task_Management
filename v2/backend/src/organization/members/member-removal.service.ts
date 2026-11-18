import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { SessionService } from "../../auth/sessions/session.service";
import { HTTPException } from "../../common/errors/http-exception";
import { UserEntity } from "../../database/entities/user.entity";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { clearMemberProjectAccess } from "../../project-access/clear-member-project-access";
import { RealtimeConnections } from "../../realtime/realtime-connections";
import { WorkspaceMemberLifecycleService } from "../../workspace-members/workspace-member-lifecycle.service";
import { countOwners, hasOwnerRole } from "../lookups/count-owners";
import {
  findMember,
  findMemberByEmail,
  findMemberById,
} from "../lookups/find-member";
import { findWorkspaceById } from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { memberOutput, memberWithUserOutput } from "../output/member-output";
import { OrganizationPermissionService } from "../roles/organization-permission.service";
import { CREATOR_ROLE } from "../roles/role-authorization";

@Injectable()
export class MemberRemovalService {
  private readonly logger = new Logger(MemberRemovalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: OrganizationPermissionService,
    private readonly sessions: SessionService,
    private readonly lifecycle: WorkspaceMemberLifecycleService,
    private readonly realtime: RealtimeConnections,
  ) {}

  /** Removes another member (or the caller), by membership id or email. */
  async remove(
    caller: OrganizationCaller,
    memberIdOrEmail: string,
    organizationId: string | undefined,
  ) {
    const manager = this.dataSource.manager;
    const workspaceId = organizationId || activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");

    const actor = await findMember(manager, caller.user.id, workspaceId);
    if (!actor) throw organizationError(400, "MEMBER_NOT_FOUND");

    // By email the member comes back with its user; by id without, as before.
    const target = memberIdOrEmail.includes("@")
      ? await findMemberByEmail(manager, memberIdOrEmail, workspaceId).then(
          (found) => found && memberWithUserOutput(found.member, found.user),
        )
      : await findMemberById(manager, memberIdOrEmail).then(
          (found) => found && memberOutput(found.member),
        );
    if (!target) throw organizationError(400, "MEMBER_NOT_FOUND");

    if (hasOwnerRole(target.role)) {
      const actorRoles = actor.member.role.split(",").map((role) => role.trim());
      if (
        !actorRoles.includes(CREATOR_ROLE) ||
        (await countOwners(manager, workspaceId)) <= 1
      ) {
        throw organizationError(
          400,
          "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
        );
      }
    }
    const allowed = await this.permissions.hasPermission({
      workspaceId,
      role: actor.member.role,
      permissions: { member: ["delete"] },
    });
    if (!allowed) {
      throw organizationError(401, "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER");
    }
    if (target.organizationId !== workspaceId) {
      throw organizationError(400, "MEMBER_NOT_FOUND");
    }
    if (!(await findWorkspaceById(manager, workspaceId))) {
      throw organizationError(400, "ORGANIZATION_NOT_FOUND");
    }
    const removedUser = await manager.findOne(UserEntity, {
      where: { id: target.userId },
    });
    if (!removedUser) throw new HTTPException(400, { message: "User not found" });

    await this.deleteMembership(target.id, workspaceId, target.userId);
    if (
      caller.session &&
      caller.user.id === target.userId &&
      activeOrganizationOf(caller) === workspaceId
    ) {
      await this.sessions.setActiveOrganization(caller.session.id, null);
    }

    await this.lifecycle.handleMemberRemoved({
      workspaceId,
      userId: target.userId,
      userRole: removedUser.role,
    });
    return { member: target };
  }

  /** The caller leaves a workspace; its last owner cannot. */
  async leave(caller: OrganizationCaller, workspaceId: string) {
    const manager = this.dataSource.manager;
    const found = await findMember(manager, caller.user.id, workspaceId);
    if (!found) throw organizationError(400, "MEMBER_NOT_FOUND");
    if (
      hasOwnerRole(found.member.role) &&
      (await countOwners(manager, workspaceId)) <= 1
    ) {
      throw organizationError(
        400,
        "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
      );
    }

    await this.deleteMembership(found.member.id, workspaceId, caller.user.id);
    if (caller.session && activeOrganizationOf(caller) === workspaceId) {
      await this.sessions.setActiveOrganization(caller.session.id, null);
    }

    // The membership is gone at this point; a failed cleanup must not keep
    // the departed user's sockets open.
    await clearMemberProjectAccess(manager, workspaceId, caller.user.id).catch(
      (error: unknown) => {
        this.logger.error("Project access cleanup failed:", error);
      },
    );
    await this.realtime.revokeWorkspaceConnections(caller.user.id, workspaceId, {
      role: caller.user.role ?? null,
    });
    return memberWithUserOutput(found.member, found.user);
  }

  /** Deletes the membership and the user's places in the workspace's teams. */
  private deleteMembership(memberId: string, workspaceId: string, userId: string) {
    return this.dataSource.transaction(async (tx: EntityManager) => {
      await tx.delete(WorkspaceUserEntity, { id: memberId });
      await tx.query(
        `DELETE FROM team_member WHERE user_id = $1
         AND team_id IN (SELECT id FROM team WHERE workspace_id = $2)`,
        [userId, workspaceId],
      );
    });
  }
}
