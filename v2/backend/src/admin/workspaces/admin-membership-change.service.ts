import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { insertReturning } from "../../database/dml";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { EventBus } from "../../events/event-bus";
import { clearMemberProjectAccess } from "../../project-access/clear-member-project-access";
import { isOwnerRole } from "../../project-access/is-owner-role";
import { WorkspaceMemberLifecycleService } from "../../workspace-members/workspace-member-lifecycle.service";
import { AdminWorkspaceMembersService } from "./admin-workspace-members.service";
import { isAssignableWorkspaceRole } from "./is-assignable-workspace-role";
import { lockWorkspace } from "./lock-workspace";

type MemberTarget = { workspaceId: string; userId: string };

/**
 * An instance administrator's changes to a workspace's members. Each locks
 * the workspace first, so the only owner can never be removed or demoted.
 */
@Injectable()
export class AdminMembershipChangeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly lifecycle: WorkspaceMemberLifecycleService,
    private readonly members: AdminWorkspaceMembersService,
  ) {}

  async addMember({ workspaceId, userId, role }: MemberTarget & { role: string }) {
    await this.dataSource.transaction(async (manager) => {
      const members = await lockWorkspace(manager, workspaceId);
      const users = (await manager.query(
        `SELECT id FROM "user" WHERE id = $1 LIMIT 1`,
        [userId],
      )) as unknown[];
      if (users.length === 0) {
        throw new HTTPException(404, { message: "User not found" });
      }
      if (members.some((member) => member.userId === userId)) {
        throw new HTTPException(409, {
          message: "This user is already a member of the workspace",
        });
      }
      if (!(await isAssignableWorkspaceRole(manager, workspaceId, role))) {
        throw new HTTPException(400, {
          message:
            "Unknown role. To make someone the owner, add them and then transfer ownership",
        });
      }

      await clearMemberProjectAccess(manager, workspaceId, userId);
      await insertReturning(manager, WorkspaceUserEntity, {
        workspaceId,
        userId,
        role,
        joinedAt: new Date(),
      });
    });

    await this.lifecycle.handleMemberAdded(workspaceId, userId);
    return this.members.listMembers(workspaceId);
  }

  async updateMemberRole({
    workspaceId,
    userId,
    role,
  }: MemberTarget & { role: string }) {
    await this.dataSource.transaction(async (manager) => {
      const members = await lockWorkspace(manager, workspaceId);
      const member = members.find((candidate) => candidate.userId === userId);
      if (!member) {
        throw new HTTPException(404, { message: "Member not found" });
      }
      if (!(await isAssignableWorkspaceRole(manager, workspaceId, role))) {
        throw new HTTPException(400, {
          message:
            "Unknown role. Use the ownership transfer to make someone the owner",
        });
      }
      const owners = members.filter((candidate) => isOwnerRole(candidate.role));
      if (isOwnerRole(member.role) && owners.length === 1) {
        throw new HTTPException(409, {
          message:
            "Transfer ownership to another member before changing the only owner's role",
        });
      }

      await manager.update(WorkspaceUserEntity, { workspaceId, userId }, { role });
    });

    return this.members.listMembers(workspaceId);
  }

  async removeMember({ workspaceId, userId }: MemberTarget) {
    await this.dataSource.transaction(async (manager) => {
      const members = await lockWorkspace(manager, workspaceId);
      const member = members.find((candidate) => candidate.userId === userId);
      if (!member) {
        throw new HTTPException(404, { message: "Member not found" });
      }
      const owners = members.filter((candidate) => isOwnerRole(candidate.role));
      if (isOwnerRole(member.role) && owners.length === 1) {
        throw new HTTPException(409, {
          message:
            "Transfer ownership to another member before removing the only owner",
        });
      }

      await manager.delete(WorkspaceUserEntity, { workspaceId, userId });
    });

    const [user] = (await this.dataSource.query(
      `SELECT role FROM "user" WHERE id = $1 LIMIT 1`,
      [userId],
    )) as { role: string | null }[];
    await this.lifecycle.handleMemberRemoved({
      workspaceId,
      userId,
      userRole: user?.role,
    });
    return this.members.listMembers(workspaceId);
  }

  async transferOwnership({ workspaceId, userId }: MemberTarget) {
    await this.dataSource.transaction(async (manager) => {
      const members = await lockWorkspace(manager, workspaceId);
      const target = members.find((candidate) => candidate.userId === userId);
      if (!target) {
        throw new HTTPException(404, { message: "Member not found" });
      }
      const otherOwners = members
        .filter((candidate) => isOwnerRole(candidate.role))
        .map((owner) => owner.userId)
        .filter((ownerId) => ownerId !== userId);
      if (isOwnerRole(target.role) && otherOwners.length === 0) {
        throw new HTTPException(400, {
          message: "This member is already the workspace owner",
        });
      }

      if (otherOwners.length > 0) {
        await manager.update(
          WorkspaceUserEntity,
          { workspaceId, userId: In(otherOwners) },
          { role: "admin" },
        );
      }
      await manager.update(
        WorkspaceUserEntity,
        { workspaceId, userId },
        { role: "owner" },
      );
      await clearMemberProjectAccess(manager, workspaceId, userId);
    });

    await this.events.publish("project_access.updated", { workspaceId, userId });
    return this.members.listMembers(workspaceId);
  }
}
