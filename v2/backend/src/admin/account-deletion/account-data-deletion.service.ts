import { Injectable, Logger } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { instanceAdminRoleSql } from "../../access/instance-admin-role";
import { ApiError } from "../../common/errors/api-error";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { WorkspaceEntity } from "../../database/entities/workspace.entity";
import { RealtimeConnections } from "../../realtime/realtime-connections";
import { AccountDeletionBilling } from "./account-deletion-billing";
import {
  type AccountDeletionPlan,
  formatBlockedWorkspacesMessage,
  hasOwnerRole,
  planAccountDeletion,
  type WorkspaceMembershipSummary,
} from "./account-deletion-plan";
import { formatBillableWorkspacesMessage } from "./format-billable-workspaces-message";

type MembershipRow = {
  workspace_id: string;
  workspace_name: string;
  role: string;
  is_caller: boolean;
};

/**
 * Settles an account's workspaces before the account is deleted: a
 * workspace nobody else belongs to goes with it, others it just leaves. It
 * refuses while the account is the only owner of a shared workspace, or a
 * workspace it would delete still has an active subscription.
 */
@Injectable()
export class AccountDataDeletionService {
  private readonly logger = new Logger(AccountDataDeletionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeConnections,
    private readonly billing: AccountDeletionBilling,
  ) {}

  async deleteAccountData(userId: string): Promise<AccountDeletionPlan> {
    const plan = planAccountDeletion(await this.collectMemberships(userId));

    if (plan.blockedWorkspaceNames.length > 0) {
      throw new ApiError(409, {
        code: "SOLE_WORKSPACE_OWNER",
        message: formatBlockedWorkspacesMessage(plan.blockedWorkspaceNames),
      });
    }

    const billable = await this.billing.findBillableWorkspaces(
      plan.workspaceIdsToDelete,
    );
    if (billable.length > 0) {
      throw new ApiError(409, {
        code: "WORKSPACE_HAS_ACTIVE_SUBSCRIPTION",
        message: formatBillableWorkspacesMessage(
          billable.map((workspace) => workspace.name),
        ),
      });
    }

    const manager = this.dataSource.manager;
    if (plan.workspaceIdsToDelete.length > 0) {
      const admins = (await manager.query(
        `SELECT id FROM "user" WHERE ${instanceAdminRoleSql("role")}`,
      )) as { id: string }[];
      const recipients = new Set([userId, ...admins.map((admin) => admin.id)]);
      await manager.delete(WorkspaceEntity, {
        id: In(plan.workspaceIdsToDelete),
      });
      for (const workspaceId of plan.workspaceIdsToDelete) {
        await Promise.all(
          [...recipients].map((recipient) =>
            this.realtime.revokeWorkspaceConnections(recipient, workspaceId, {
              force: true,
            }),
          ),
        );
      }
    }

    if (plan.workspaceIdsToLeave.length > 0) {
      await manager.delete(WorkspaceUserEntity, {
        userId,
        workspaceId: In(plan.workspaceIdsToLeave),
      });
      for (const workspaceId of plan.workspaceIdsToLeave) {
        await this.billing.syncWorkspaceSeats(workspaceId).catch((error) => {
          this.logger.error(
            `Seat sync after account deletion failed: ${workspaceId}`,
            error,
          );
        });
      }
    }

    for (const workspaceId of plan.workspaceIdsToLeave) {
      await this.realtime.revokeWorkspaceConnections(userId, workspaceId, {
        force: true,
      });
    }

    return plan;
  }

  private async collectMemberships(
    userId: string,
  ): Promise<WorkspaceMembershipSummary[]> {
    const rows = (await this.dataSource.query(
      `SELECT member.workspace_id, workspace.name AS workspace_name, member.role,
              member.user_id = $1 AS is_caller
       FROM workspace_member AS member
       JOIN workspace ON workspace.id = member.workspace_id
       WHERE member.workspace_id IN (
         SELECT workspace_id FROM workspace_member WHERE user_id = $1
       )`,
      [userId],
    )) as MembershipRow[];

    return rows
      .filter((row) => row.is_caller)
      .map((membership) => {
        const members = rows.filter(
          (row) => row.workspace_id === membership.workspace_id,
        );
        return {
          workspaceId: membership.workspace_id,
          workspaceName: members[0]?.workspace_name ?? "workspace",
          isOwner: hasOwnerRole(membership.role),
          memberCount: members.length,
          ownerCount: members.filter((member) => hasOwnerRole(member.role))
            .length,
        };
      });
  }
}
