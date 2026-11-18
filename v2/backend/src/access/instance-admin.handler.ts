import { Injectable } from "@nestjs/common";
import type { ApiRequest } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import type { AccessRuleHandler } from "./access-rule";
import { WorkspacePermissionService } from "./workspace-permission.service";

@Injectable()
export class InstanceAdminHandler implements AccessRuleHandler<void> {
  constructor(private readonly permissions: WorkspacePermissionService) {}

  async check(request: ApiRequest): Promise<void> {
    if (!(await this.permissions.isInstanceAdmin(request))) {
      throw new HTTPException(403, {
        message: "Instance administrator access is required",
      });
    }
  }
}
