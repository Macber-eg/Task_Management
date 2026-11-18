import { Module } from "@nestjs/common";
import { WorkspaceMembersModule } from "../workspace-members/workspace-members.module";
import { AccountDataDeletionService } from "./account-deletion/account-data-deletion.service";
import { AdminController } from "./admin.controller";
import { AdminBanService } from "./auth-admin/admin-ban.service";
import { AdminUserRemovalService } from "./auth-admin/admin-user-removal.service";
import { AdminUserUpdateService } from "./auth-admin/admin-user-update.service";
import { AuthAdminController } from "./auth-admin/auth-admin.controller";
import { AdminUserQueryService } from "./users/admin-user-query.service";
import { AdminMembershipChangeService } from "./workspaces/admin-membership-change.service";
import { AdminWorkspaceMembersService } from "./workspaces/admin-workspace-members.service";
import { AdminWorkspaceQueryService } from "./workspaces/admin-workspace-query.service";

/**
 * Instance administration: /api/admin, and the account endpoints under
 * /api/auth/admin.
 */
@Module({
  imports: [WorkspaceMembersModule],
  controllers: [AdminController, AuthAdminController],
  providers: [
    AdminUserQueryService,
    AdminWorkspaceQueryService,
    AdminWorkspaceMembersService,
    AdminMembershipChangeService,
    AdminUserUpdateService,
    AdminBanService,
    AdminUserRemovalService,
    AccountDataDeletionService,
  ],
  exports: [AccountDataDeletionService],
})
export class AdminModule {}
