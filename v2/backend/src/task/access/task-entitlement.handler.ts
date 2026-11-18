import { Injectable } from "@nestjs/common";
import type { AccessRule, AccessRuleHandler } from "../../access/access-rule";
import type { ApiRequest } from "../../auth/principal";
import { TaskEntitlements } from "../seams/task-entitlements";

/**
 * Blocks the request when the workspace an earlier rule resolved has no
 * active entitlement. Does nothing when no workspace was resolved.
 */
@Injectable()
export class TaskEntitlementHandler implements AccessRuleHandler<void> {
  constructor(private readonly entitlements: TaskEntitlements) {}

  async check(request: ApiRequest): Promise<void> {
    if (request.workspaceId) {
      await this.entitlements.requireWorkspaceEntitlement(request.workspaceId);
    }
  }
}

export const requireEntitlement: AccessRule<void> = {
  handler: TaskEntitlementHandler,
  options: undefined,
};
