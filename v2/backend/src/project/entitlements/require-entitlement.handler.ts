import { Injectable } from "@nestjs/common";
import type { AccessRuleHandler } from "../../access/access-rule";
import type { ApiRequest } from "../../auth/principal";
import { ProjectEntitlements } from "./project-entitlements";

/** Refuses the request when the resolved workspace's plan has expired. */
@Injectable()
export class RequireEntitlementHandler implements AccessRuleHandler<null> {
  constructor(private readonly entitlements: ProjectEntitlements) {}

  async check(request: ApiRequest): Promise<void> {
    if (request.workspaceId) {
      await this.entitlements.requireWorkspaceEntitlement(request.workspaceId);
    }
  }
}
