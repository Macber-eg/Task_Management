import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../project-access/project-access.module";
import { WorkspaceMembersModule } from "../workspace-members/workspace-members.module";
import { InvitationController } from "./invitations/invitation.controller";
import { InvitationCancellationService } from "./invitations/invitation-cancellation.service";
import { InvitationCreationService } from "./invitations/invitation-creation.service";
import { InvitationLookupService } from "./invitations/invitation-lookup.service";
import { InvitationMailer } from "./invitations/invitation-mailer";
import { InvitationResponseService } from "./invitations/invitation-response.service";
import { NoopInvitationMailer } from "./invitations/noop-invitation-mailer";
import { MemberController } from "./members/member.controller";
import { MemberQueryService } from "./members/member-query.service";
import { MemberRemovalService } from "./members/member-removal.service";
import { MemberRoleService } from "./members/member-role.service";
import { OrganizationCallerService } from "./organization-caller.service";
import { DefaultRolesBackfill } from "./roles/default-roles-backfill";
import { OrganizationPermissionService } from "./roles/organization-permission.service";
import { RoleController } from "./roles/role.controller";
import { RoleAccessService } from "./roles/role-access.service";
import { RoleCreationService } from "./roles/role-creation.service";
import { RoleDeletionService } from "./roles/role-deletion.service";
import { RoleQueryService } from "./roles/role-query.service";
import { RoleUpdateService } from "./roles/role-update.service";
import { ActiveOrganizationService } from "./workspaces/active-organization.service";
import { NoopWorkspaceDeletionGuard } from "./workspaces/noop-workspace-deletion-guard";
import { OrganizationQueryService } from "./workspaces/organization-query.service";
import { WorkspaceController } from "./workspaces/workspace.controller";
import { WorkspaceCreationService } from "./workspaces/workspace-creation.service";
import { WorkspaceDeletionGuard } from "./workspaces/workspace-deletion-guard";
import { WorkspaceDeletionService } from "./workspaces/workspace-deletion.service";
import { WorkspaceUpdateService } from "./workspaces/workspace-update.service";

/**
 * The workspace ("organization") endpoints under /api/auth/organization,
 * with the paths, bodies and errors of the auth library the previous
 * backend used for them.
 */
@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule],
  controllers: [
    WorkspaceController,
    MemberController,
    InvitationController,
    RoleController,
  ],
  providers: [
    OrganizationCallerService,
    OrganizationPermissionService,
    DefaultRolesBackfill,
    WorkspaceCreationService,
    WorkspaceUpdateService,
    WorkspaceDeletionService,
    OrganizationQueryService,
    ActiveOrganizationService,
    MemberQueryService,
    MemberRoleService,
    MemberRemovalService,
    InvitationCreationService,
    InvitationResponseService,
    InvitationCancellationService,
    InvitationLookupService,
    RoleAccessService,
    RoleQueryService,
    RoleCreationService,
    RoleUpdateService,
    RoleDeletionService,
    { provide: InvitationMailer, useClass: NoopInvitationMailer },
    { provide: WorkspaceDeletionGuard, useClass: NoopWorkspaceDeletionGuard },
  ],
})
export class OrganizationModule {}
