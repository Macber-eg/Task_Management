import { Injectable } from "@nestjs/common";
import type { AccessRule, AccessRuleHandler } from "../../access/access-rule";
import type { ApiRequest } from "../../auth/principal";
import { UploadEntitlement } from "./upload-entitlement";

/** Runs after a workspace rule, which sets `request.workspaceId`. */
@Injectable()
export class UploadEntitlementHandler implements AccessRuleHandler<null> {
  constructor(private readonly entitlement: UploadEntitlement) {}

  async check(request: ApiRequest): Promise<void> {
    if (request.workspaceId) {
      await this.entitlement.requireWorkspaceEntitlement(request.workspaceId);
    }
  }
}

export function requireUploadEntitlement(): AccessRule<null> {
  return { handler: UploadEntitlementHandler, options: null };
}
