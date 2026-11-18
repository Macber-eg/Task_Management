import { Injectable } from "@nestjs/common";
import { createId } from "@paralleldrive/cuid2";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { WorkspaceUserEntity } from "../database/entities/workspace-user.entity";
import {
  type BillingInterval,
  isBillingEnabled,
  type Plan,
  productIdFor,
} from "./billing-config";
import { CreemClient } from "./creem-client";
import { WorkspaceBillingService } from "./workspace-billing.service";

@Injectable()
export class CheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly billing: WorkspaceBillingService,
    private readonly creem: CreemClient,
  ) {}

  /** A Creem checkout for the plan; team plans bill one seat per member. */
  async createCheckout({
    workspaceId,
    plan,
    interval,
    userEmail,
  }: {
    workspaceId: string;
    plan: Plan;
    interval: BillingInterval;
    userEmail: string;
  }): Promise<{ checkoutUrl: string }> {
    if (!isBillingEnabled()) {
      throw new HTTPException(400, { message: "Billing is not enabled" });
    }

    const productId = productIdFor(plan, interval);
    if (!productId) {
      throw new HTTPException(400, { message: "Unknown plan" });
    }

    const billing = await this.billing.getOrCreateWorkspaceBilling(workspaceId);
    if (billing.status === "active") {
      throw new HTTPException(400, {
        message: "Workspace already has an active subscription",
      });
    }

    let units = 1;
    if (plan === "team") {
      const members = await this.dataSource.manager.countBy(
        WorkspaceUserEntity,
        { workspaceId },
      );
      units = Math.max(1, members);
    }

    const clientUrl = process.env.KANEO_CLIENT_URL ?? "";
    const { checkoutUrl } = await this.creem.createCheckoutSession({
      productId,
      units,
      successUrl: `${clientUrl}/dashboard/settings/workspace/billing?checkout=success`,
      requestId: createId(),
      customerEmail: userEmail,
      metadata: { workspaceId, plan, interval },
    });

    return { checkoutUrl };
  }
}
