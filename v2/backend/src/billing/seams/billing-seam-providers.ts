import type { Abstract, Provider, Type } from "@nestjs/common";
import { AccountDeletionBilling } from "../../admin/account-deletion/account-deletion-billing";
import { WorkspaceDeletionGuard } from "../../organization/workspaces/workspace-deletion-guard";
import { ProjectEntitlements } from "../../project/entitlements/project-entitlements";
import { UploadEntitlement } from "../../storage/upload/upload-entitlement";
import { TaskEntitlements } from "../../task/seams/task-entitlements";
import { WorkspaceSeatSync } from "../../workspace-members/workspace-seat-sync";
import { BillingEntitlementService } from "../billing-entitlement.service";
import { SeatSyncService } from "../seat-sync.service";
import { BillingAccountDeletion } from "./billing-account-deletion";
import { BillingWorkspaceDeletionGuard } from "./billing-workspace-deletion-guard";

/** Binds a seam to a billing service whose shape is checked against it. */
function seam<T>(token: Abstract<T>, existing: Type<T>): Provider {
  return { provide: token, useExisting: existing };
}

/** The billing implementations of the seams other features declare. */
export const billingSeamProviders: Provider[] = [
  seam(ProjectEntitlements, BillingEntitlementService),
  seam(TaskEntitlements, BillingEntitlementService),
  seam(UploadEntitlement, BillingEntitlementService),
  seam(WorkspaceSeatSync, SeatSyncService),
  { provide: WorkspaceDeletionGuard, useClass: BillingWorkspaceDeletionGuard },
  { provide: AccountDeletionBilling, useClass: BillingAccountDeletion },
];

export const billingSeamTokens = [
  ProjectEntitlements,
  TaskEntitlements,
  UploadEntitlement,
  WorkspaceSeatSync,
  WorkspaceDeletionGuard,
  AccountDeletionBilling,
];
