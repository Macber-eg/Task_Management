import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { insertReturning, updateReturning } from "../../database/dml";
import { BillingEventEntity } from "../../database/entities/billing-event.entity";
import { WorkspaceBillingEntity } from "../../database/entities/workspace-billing.entity";
import { planForProductId } from "../billing-config";
import type {
  BillingWebhookEvent,
  BillingWebhookResult,
} from "./billing-webhook-event";
import { buildSubscriptionUpdates } from "./subscription-updates";

/** Applies a verified Creem event to the workspace's billing row, once per event id. */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(private readonly dataSource: DataSource) {}

  async handleWebhook(event: BillingWebhookEvent): Promise<BillingWebhookResult> {
    const eventId = event.id;
    if (!eventId) {
      return this.applyEvent(event, this.dataSource.manager);
    }

    // A claim that outlives a failed apply makes the retry look like a duplicate.
    return this.dataSource.transaction(async (manager) => {
      const claimed = await insertReturning(
        manager,
        BillingEventEntity,
        { id: eventId, eventType: event.type },
        { onConflict: { target: ["id"] } },
      );
      if (!claimed) {
        return { processed: false, duplicate: true };
      }
      return this.applyEvent(event, manager);
    });
  }

  private async applyEvent(
    event: BillingWebhookEvent,
    manager: EntityManager,
  ): Promise<BillingWebhookResult> {
    const object = event.data;

    if (event.type === "checkout.completed") {
      const workspaceId =
        object.metadata?.workspaceId ??
        object.subscription?.metadata?.workspaceId;
      if (!workspaceId) {
        this.logger.error("billing: checkout.completed without workspaceId");
        return { processed: false, duplicate: false };
      }

      const productId = object.product?.id ?? object.subscription?.product?.id;
      const mapped = productId ? planForProductId(productId) : null;

      await updateReturning(
        manager,
        WorkspaceBillingEntity,
        {
          creemCustomerId:
            object.customer?.id ?? object.subscription?.customer?.id ?? null,
          creemSubscriptionId: object.subscription?.id ?? null,
          creemProductId: productId ?? null,
          plan: mapped?.plan ?? null,
          billingInterval: mapped?.interval ?? null,
          status: object.subscription?.status ?? "active",
        },
        { workspaceId },
      );
      return { processed: true, duplicate: false };
    }

    if (event.type.startsWith("subscription.")) {
      const subscriptionId = object.id;
      if (!subscriptionId) {
        return { processed: false, duplicate: false };
      }

      const updates = buildSubscriptionUpdates(event);
      const updated = await updateReturning(
        manager,
        WorkspaceBillingEntity,
        updates,
        { creemSubscriptionId: subscriptionId },
      );

      const workspaceId = object.metadata?.workspaceId;
      if (updated.length === 0 && workspaceId) {
        await updateReturning(
          manager,
          WorkspaceBillingEntity,
          { ...updates, creemSubscriptionId: subscriptionId },
          { workspaceId },
        );
      }
      return { processed: true, duplicate: false };
    }

    return { processed: true, duplicate: false };
  }
}
