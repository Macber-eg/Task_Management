import { Injectable } from "@nestjs/common";
import { HTTPException } from "../common/errors/http-exception";
import { CreemClient } from "./creem-client";
import { WorkspaceBillingService } from "./workspace-billing.service";

@Injectable()
export class BillingPortalService {
  constructor(
    private readonly billing: WorkspaceBillingService,
    private readonly creem: CreemClient,
  ) {}

  /** A customer portal link; only once checkout has created a customer. */
  async createPortalLink(workspaceId: string): Promise<{ portalUrl: string }> {
    const billing = await this.billing.getOrCreateWorkspaceBilling(workspaceId);
    if (!billing.creemCustomerId) {
      throw new HTTPException(400, {
        message: "No billing customer exists for this workspace yet",
      });
    }
    return this.creem.createCustomerPortalLink(billing.creemCustomerId);
  }
}
