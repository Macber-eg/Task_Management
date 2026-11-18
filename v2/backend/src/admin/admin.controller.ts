import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireInstanceAdmin } from "../access/require-instance-admin";
import { requireUserSession } from "../access/require-user-session";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  addWorkspaceMemberRoute,
  listUsersRoute,
  listWorkspaceMembersRoute,
  listWorkspaceRolesRoute,
  listWorkspacesRoute,
  removeWorkspaceMemberRoute,
  transferWorkspaceOwnershipRoute,
  updateWorkspaceMemberRoleRoute,
} from "./admin.routes";
import { AdminUserQueryService } from "./users/admin-user-query.service";
import { AdminMembershipChangeService } from "./workspaces/admin-membership-change.service";
import { AdminWorkspaceMembersService } from "./workspaces/admin-workspace-members.service";
import { AdminWorkspaceQueryService } from "./workspaces/admin-workspace-query.service";

/** Instance administration; never reachable with an API key. */
@Controller("admin")
export class AdminController {
  constructor(
    private readonly users: AdminUserQueryService,
    private readonly workspaces: AdminWorkspaceQueryService,
    private readonly members: AdminWorkspaceMembersService,
    private readonly changes: AdminMembershipChangeService,
  ) {}

  @ApiRoute(listUsersRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  listUsers(@Input() input: RouteInput<typeof listUsersRoute>) {
    return this.users.listUsers(input.query);
  }

  @ApiRoute(listWorkspacesRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  listWorkspaces(@Input() input: RouteInput<typeof listWorkspacesRoute>) {
    return this.workspaces.listWorkspaces(input.query);
  }

  @ApiRoute(listWorkspaceMembersRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  listWorkspaceMembers(
    @Input() input: RouteInput<typeof listWorkspaceMembersRoute>,
  ) {
    return this.members.listMembers(input.param.workspaceId);
  }

  @ApiRoute(listWorkspaceRolesRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  listWorkspaceRoles(@Input() input: RouteInput<typeof listWorkspaceRolesRoute>) {
    return this.members.listAssignableRoles(input.param.workspaceId);
  }

  @ApiRoute(addWorkspaceMemberRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  addWorkspaceMember(
    @Input() input: RouteInput<typeof addWorkspaceMemberRoute>,
  ) {
    return this.changes.addMember({
      workspaceId: input.param.workspaceId,
      ...input.json,
    });
  }

  @ApiRoute(updateWorkspaceMemberRoleRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  updateWorkspaceMemberRole(
    @Input() input: RouteInput<typeof updateWorkspaceMemberRoleRoute>,
  ) {
    return this.changes.updateMemberRole({
      ...input.param,
      role: input.json.role,
    });
  }

  @ApiRoute(removeWorkspaceMemberRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  removeWorkspaceMember(
    @Input() input: RouteInput<typeof removeWorkspaceMemberRoute>,
  ) {
    return this.changes.removeMember(input.param);
  }

  @ApiRoute(transferWorkspaceOwnershipRoute)
  @Access(requireUserSession(), requireInstanceAdmin())
  transferWorkspaceOwnership(
    @Input() input: RouteInput<typeof transferWorkspaceOwnershipRoute>,
  ) {
    return this.changes.transferOwnership({
      workspaceId: input.param.workspaceId,
      userId: input.json.userId,
    });
  }
}
