import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { instanceAdminRoleSql } from "../../access/instance-admin-role";
import { SessionService } from "../../auth/sessions/session.service";
import { HTTPException } from "../../common/errors/http-exception";
import { InvitationEntity } from "../../database/entities/invitation.entity";
import { WorkspaceEntity } from "../../database/entities/workspace.entity";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { RealtimeConnections } from "../../realtime/realtime-connections";
import { findMember } from "../lookups/find-member";
import { findWorkspaceById } from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { workspaceOutput } from "../output/workspace-output";
import { OrganizationPermissionService } from "../roles/organization-permission.service";
import { WorkspaceDeletionGuard } from "./workspace-deletion-guard";

@Injectable()
export class WorkspaceDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: OrganizationPermissionService,
    private readonly sessions: SessionService,
    private readonly guard: WorkspaceDeletionGuard,
    private readonly realtime: RealtimeConnections,
  ) {}

  async delete(caller: OrganizationCaller, workspaceId: string) {
    const manager = this.dataSource.manager;
    if (!workspaceId) throw organizationError(400, "ORGANIZATION_NOT_FOUND");

    const found = await findMember(manager, caller.user.id, workspaceId);
    if (!found) {
      throw organizationError(400, "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION");
    }
    const allowed = await this.permissions.hasPermission({
      workspaceId,
      role: found.member.role,
      permissions: { organization: ["delete"] },
    });
    if (!allowed) {
      throw organizationError(
        403,
        "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION",
      );
    }

    // Cleared before the checks below, so even a refused deletion leaves the
    // caller without an active workspace, as it always has.
    if (caller.session && workspaceId === activeOrganizationOf(caller)) {
      await this.sessions.setActiveOrganization(caller.session.id, null);
    }

    const workspace = await findWorkspaceById(manager, workspaceId);
    if (!workspace) throw new HTTPException(400);
    await this.guard.assertDeletable(workspace);

    const affectedUserIds = await this.usersWithAccess(workspaceId);
    await this.dataSource.transaction(async (tx) => {
      await tx.delete(WorkspaceUserEntity, { workspaceId });
      await tx.delete(InvitationEntity, { workspaceId });
      await tx.delete(WorkspaceEntity, { id: workspaceId });
    });

    // Instance admins see every workspace without a membership, so their
    // sockets for it are closed too.
    await Promise.all(
      affectedUserIds.map((userId) =>
        this.realtime.revokeWorkspaceConnections(userId, workspaceId, {
          force: true,
        }),
      ),
    );
    return workspaceOutput(workspace);
  }

  private async usersWithAccess(workspaceId: string): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `SELECT user_id AS "userId" FROM workspace_member WHERE workspace_id = $1
       UNION
       SELECT id AS "userId" FROM "user" WHERE ${instanceAdminRoleSql("role")}`,
      [workspaceId],
    )) as { userId: string }[];
    return rows.map((row) => row.userId);
  }
}
