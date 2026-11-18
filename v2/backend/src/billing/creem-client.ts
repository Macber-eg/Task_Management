import { Injectable, Logger } from "@nestjs/common";
import { Creem } from "creem";
import { HTTPException } from "../common/errors/http-exception";
import { creemApiKey, isCreemTestMode } from "./billing-config";

/** The calls Kaneo makes to the Creem API. Tests replace this provider. */
@Injectable()
export class CreemClient {
  private readonly logger = new Logger(CreemClient.name);

  private client() {
    return new Creem({
      apiKey: creemApiKey(),
      server: isCreemTestMode() ? "test" : "prod",
    });
  }

  async createCheckoutSession(input: {
    productId: string;
    units: number;
    successUrl: string;
    requestId: string;
    customerEmail: string;
    metadata: Record<string, string>;
  }): Promise<{ checkoutUrl: string }> {
    try {
      const checkout = await this.client().checkouts.create({
        productId: input.productId,
        units: input.units,
        successUrl: input.successUrl,
        requestId: input.requestId,
        customer: { email: input.customerEmail },
        metadata: input.metadata,
      });

      if (!checkout.checkoutUrl) {
        throw new Error("Checkout session has no URL");
      }
      return { checkoutUrl: checkout.checkoutUrl };
    } catch (error) {
      this.logger.error("Creem checkout creation failed", error);
      throw new HTTPException(502, {
        message: "Billing provider request failed",
      });
    }
  }

  async updateSubscriptionSeats(input: {
    subscriptionId: string;
    productId: string;
    units: number;
  }): Promise<void> {
    const client = this.client();

    const subscription = await client.subscriptions.get(input.subscriptionId);
    const items = subscription.items ?? [];
    // A stale stored product id still resolves on a single-item subscription,
    // which is the shape Kaneo sells. Guessing among several items would bill
    // the wrong product, so that case has to be repaired by hand.
    const item =
      items.find((entry) => entry.productId === input.productId) ??
      (items.length === 1 ? items[0] : undefined);

    if (!item) {
      throw new Error(
        `Creem subscription ${input.subscriptionId} has no item for product ${input.productId}`,
      );
    }

    // Creem creates an additional item when the item id is omitted, and rejects
    // the duplicate product with a 403, so the existing item id must be sent.
    await client.subscriptions.update(input.subscriptionId, {
      items: [{ id: item.id, units: input.units }],
      updateBehavior: "proration-charge",
    });
  }

  async createCustomerPortalLink(
    customerId: string,
  ): Promise<{ portalUrl: string }> {
    try {
      const links = await this.client().customers.generateBillingLinks({
        customerId,
      });
      return { portalUrl: links.customerPortalLink };
    } catch (error) {
      this.logger.error("Creem portal link creation failed", error);
      throw new HTTPException(502, {
        message: "Billing provider request failed",
      });
    }
  }
}
