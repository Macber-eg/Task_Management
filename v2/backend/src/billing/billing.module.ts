import { Global, Module } from "@nestjs/common";
import { BillableWorkspacesService } from "./billable-workspaces.service";
import { BillingController } from "./billing.controller";
import { BillingEntitlementService } from "./billing-entitlement.service";
import { BillingManagerService } from "./billing-manager.service";
import { BillingPortalService } from "./billing-portal.service";
import { CheckoutService } from "./checkout.service";
import { CreemClient } from "./creem-client";
import { SeatReconciliation } from "./jobs/seat-reconciliation.service";
import { TrialReminders } from "./jobs/trial-reminders.service";
import { SeatSyncService } from "./seat-sync.service";
import {
  billingSeamProviders,
  billingSeamTokens,
} from "./seams/billing-seam-providers";
import { BillingWebhookService } from "./webhook/billing-webhook.service";
import { WorkspaceBillingService } from "./workspace-billing.service";

/**
 * Kaneo Cloud billing through Creem. Global because it provides the
 * entitlement, seat and deletion seams that the project, task, storage,
 * organization, membership and admin features depend on. Every check allows
 * everything unless `KANEO_CLOUD` and the Creem keys are set.
 */
@Global()
@Module({
  controllers: [BillingController],
  providers: [
    CreemClient,
    WorkspaceBillingService,
    BillingEntitlementService,
    BillableWorkspacesService,
    SeatSyncService,
    BillingManagerService,
    CheckoutService,
    BillingPortalService,
    BillingWebhookService,
    SeatReconciliation,
    TrialReminders,
    ...billingSeamProviders,
  ],
  exports: [BillingEntitlementService, ...billingSeamTokens],
})
export class BillingModule {}
