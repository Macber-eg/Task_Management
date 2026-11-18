import { Injectable } from "@nestjs/common";
import type { ApiRequest } from "../auth/principal";
import type { AccessRuleHandler } from "./access-rule";
import type { PermissionMap } from "./role-permissions";
import { WorkspacePermissionService } from "./workspace-permission.service";

/** For routes with no workspace: only checks an API key's own scope. */
@Injectable()
export class ApiKeyScopeHandler implements AccessRuleHandler<PermissionMap> {
  constructor(private readonly permissions: WorkspacePermissionService) {}

  async check(request: ApiRequest, required: PermissionMap): Promise<void> {
    this.permissions.assertApiKeyScope(request, required);
  }
}
