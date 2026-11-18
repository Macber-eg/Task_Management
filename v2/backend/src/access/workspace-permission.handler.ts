import { Injectable } from "@nestjs/common";
import type { ApiRequest } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import type { AccessRuleHandler } from "./access-rule";
import type { PermissionMap } from "./role-permissions";
import { WorkspacePermissionService } from "./workspace-permission.service";

/** Requires the permissions in the workspace an earlier rule resolved. */
@Injectable()
export class WorkspacePermissionHandler implements AccessRuleHandler<PermissionMap> {
  constructor(private readonly permissions: WorkspacePermissionService) {}

  async check(request: ApiRequest, required: PermissionMap): Promise<void> {
    const workspaceId = request.workspaceId;
    if (!workspaceId) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }

    this.permissions.assertApiKeyScope(request, required);
    if (await this.permissions.isInstanceAdmin(request)) return;

    if (!request.principal?.userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    await this.permissions.assertMemberPermission(
      request,
      workspaceId,
      required,
    );
  }
}
