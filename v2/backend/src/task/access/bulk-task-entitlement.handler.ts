import { Injectable } from "@nestjs/common";
import type { AccessRule, AccessRuleHandler } from "../../access/access-rule";
import type { ApiRequest } from "../../auth/principal";
import { bulkTaskOperation } from "./bulk-task-operation";
import { TaskEntitlementHandler } from "./task-entitlement.handler";

/** Deleting and relabeling stay possible without an entitlement. */
@Injectable()
export class BulkTaskEntitlementHandler implements AccessRuleHandler<void> {
  constructor(private readonly entitlement: TaskEntitlementHandler) {}

  async check(request: ApiRequest): Promise<void> {
    const operation = bulkTaskOperation(request);
    if (
      operation === "delete" ||
      operation === "addLabel" ||
      operation === "removeLabel"
    ) {
      return;
    }
    await this.entitlement.check(request);
  }
}

export const requireBulkTaskEntitlement: AccessRule<void> = {
  handler: BulkTaskEntitlementHandler,
  options: undefined,
};
