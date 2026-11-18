import { Injectable } from "@nestjs/common";
import { HTTPException } from "../common/errors/http-exception";
import { isBillingEnabled } from "./billing-config";
import { computeEntitlement } from "./compute-entitlement";
import { WorkspaceBillingService } from "./workspace-billing.service";

/**
 * Refuses changes in a workspace whose Kaneo Cloud plan has expired (expired
 * trial, canceled or expired subscription). Allows everything when billing
 * is disabled, so self-hosted installs are unaffected.
 */
@Injectable()
export class BillingEntitlementService {
  constructor(private readonly billing: WorkspaceBillingService) {}

  async requireWorkspaceEntitlement(workspaceId: string): Promise<void> {
    if (!isBillingEnabled()) {
      return;
    }

    const billing = await this.billing.getOrCreateWorkspaceBilling(workspaceId);
    if (!computeEntitlement(billing).active) {
      throw new HTTPException(402, {
        message:
          "This workspace's Kaneo Cloud plan has expired. Subscribe to continue creating and editing.",
      });
    }
  }
}
