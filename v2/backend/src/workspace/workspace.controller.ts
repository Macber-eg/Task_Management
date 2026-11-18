import { Controller, Req } from "@nestjs/common";
import { Access } from "../access/access-rule";
import {
  requireApiKeyScope,
  requireWorkspacePermission,
} from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { WorkspacePermissionService } from "../access/workspace-permission.service";
import { UserId } from "../auth/current-user.decorator";
import type { ApiRequest } from "../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { getMyCapabilities } from "./get-my-capabilities";
import { MemberProjectAccessQueryService } from "./member-project-access-query.service";
import { MemberProjectAccessUpdateService } from "./member-project-access-update.service";
import {
  getMyCapabilitiesRoute,
  getMyProjectAccessRoute,
  getWorkspaceMembersRoute,
  getWorkspaceProjectAccessRoute,
  getWorkspaceRoute,
  listWorkspacesRoute,
  updateMemberProjectAccessRoute,
} from "./workspace.routes";
import { WorkspaceMemberQueryService } from "./workspace-member-query.service";
import { WorkspaceQueryService } from "./workspace-query.service";

@Controller("workspace")
export class WorkspaceController {
  constructor(
    private readonly workspaces: WorkspaceQueryService,
    private readonly members: WorkspaceMemberQueryService,
    private readonly memberAccess: MemberProjectAccessQueryService,
    private readonly memberAccessUpdate: MemberProjectAccessUpdateService,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  @ApiRoute(listWorkspacesRoute)
  @Access(requireApiKeyScope({ workspace: ["read"] }))
  listWorkspaces(@UserId() userId: string) {
    return this.workspaces.listWorkspaces(userId);
  }

  @ApiRoute(getWorkspaceRoute)
  @Access(requireApiKeyScope({ workspace: ["read"] }))
  getWorkspace(
    @Input() input: RouteInput<typeof getWorkspaceRoute>,
    @UserId() userId: string,
  ) {
    return this.workspaces.getWorkspace(input.param.workspaceId, userId);
  }

  @ApiRoute(getWorkspaceMembersRoute)
  @Access(workspaceAccess.fromParam("workspaceId"))
  getWorkspaceMembers(
    @Input() input: RouteInput<typeof getWorkspaceMembersRoute>,
    @UserId() userId: string,
  ) {
    return this.members.getWorkspaceMembers({
      workspaceId: input.param.workspaceId,
      userId,
      projectId: input.query.projectId,
    });
  }

  @ApiRoute(getMyProjectAccessRoute)
  @Access(workspaceAccess.fromParam("workspaceId"))
  getMyProjectAccess(
    @Input() input: RouteInput<typeof getMyProjectAccessRoute>,
    @UserId() userId: string,
  ) {
    return this.memberAccess.getMyProjectAccess(
      input.param.workspaceId,
      userId,
    );
  }

  @ApiRoute(getMyCapabilitiesRoute)
  @Access(workspaceAccess.fromParam("workspaceId"))
  async getMyCapabilities(@Req() request: ApiRequest) {
    return getMyCapabilities(await this.permissions.permissionChecker(request));
  }

  @ApiRoute(getWorkspaceProjectAccessRoute)
  @Access(
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ member: ["update"] }),
  )
  getWorkspaceProjectAccess(
    @Input() input: RouteInput<typeof getWorkspaceProjectAccessRoute>,
    @UserId() userId: string,
  ) {
    return this.memberAccess.listWorkspaceProjectAccess(
      input.param.workspaceId,
      userId,
    );
  }

  @ApiRoute(updateMemberProjectAccessRoute)
  @Access(
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ member: ["update"] }),
  )
  updateMemberProjectAccess(
    @Input() input: RouteInput<typeof updateMemberProjectAccessRoute>,
    @UserId() actorId: string,
  ) {
    return this.memberAccessUpdate.updateMemberProjectAccess({
      workspaceId: input.param.workspaceId,
      actorId,
      userId: input.param.userId,
      projectAccess: input.json.projectAccess,
      projectIds: input.json.projectIds,
    });
  }
}
