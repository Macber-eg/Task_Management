import { Injectable } from "@nestjs/common";
import type { AccessRule, AccessRuleHandler } from "../../access/access-rule";
import type { PermissionMap } from "../../access/role-permissions";
import { WorkspacePermissionHandler } from "../../access/workspace-permission.handler";
import type { ApiRequest } from "../../auth/principal";
import type { BulkOperation } from "../mutations/bulk/bulk-task";
import { bulkTaskOperation } from "./bulk-task-operation";

function permissionFor(operation: BulkOperation): PermissionMap {
  if (operation === "delete") return { task: ["delete"] };
  if (operation === "updateAssignee") return { task: ["assign"] };
  if (operation === "addLabel" || operation === "removeLabel")
    return { label: ["update"] };
  return { task: ["update"] };
}

/** Requires the permission the bulk operation in the body needs. */
@Injectable()
export class BulkTaskPermissionHandler implements AccessRuleHandler<void> {
  constructor(private readonly permission: WorkspacePermissionHandler) {}

  async check(request: ApiRequest): Promise<void> {
    await this.permission.check(
      request,
      permissionFor(bulkTaskOperation(request)),
    );
  }
}

export const requireBulkTaskPermission: AccessRule<void> = {
  handler: BulkTaskPermissionHandler,
  options: undefined,
};
