import { Injectable } from "@nestjs/common";
import { WorkspaceMembershipService } from "../access/workspace-membership.service";
import { WorkspacePermissionService } from "../access/workspace-permission.service";
import type { ApiRequest, Principal } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectEntitlements } from "./entitlements/project-entitlements";

/**
 * The destination half of a move's authorization; the route's access rules
 * cover the source workspace.
 */
@Injectable()
export class ProjectMoveAuthorization {
  constructor(
    private readonly membership: WorkspaceMembershipService,
    private readonly permissions: WorkspacePermissionService,
    private readonly entitlements: ProjectEntitlements,
  ) {}

  async authorizeDestination(
    request: ApiRequest,
    principal: Principal,
    targetWorkspaceId: string,
  ): Promise<void> {
    await this.membership.validateWorkspaceAccess(
      principal.userId,
      targetWorkspaceId,
      principal.apiKey?.id,
      { notFoundMessage: "Destination workspace not found" },
    );
    if (
      !(await this.permissions.hasWorkspacePermission(
        request,
        { project: ["create"], workspace: ["manage_settings"] },
        targetWorkspaceId,
      ))
    )
      throw new HTTPException(403, {
        message: "Insufficient permissions in the target workspace",
      });
    await this.entitlements.requireWorkspaceEntitlement(targetWorkspaceId);
  }
}
