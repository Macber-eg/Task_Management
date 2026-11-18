import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { updateReturning } from "../database/dml";
import { WorkspaceBillingEntity } from "../database/entities/workspace-billing.entity";
import { WorkspaceUserEntity } from "../database/entities/workspace-user.entity";
import { isBillingEnabled } from "./billing-config";
import { CreemClient } from "./creem-client";

/** Keeps a team subscription's seat count equal to the workspace's members. */
@Injectable()
export class SeatSyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly creem: CreemClient,
  ) {}

  async syncWorkspaceSeats(workspaceId: string): Promise<void> {
    if (!isBillingEnabled()) {
      return;
    }

    const manager = this.dataSource.manager;
    const billing = await manager.findOne(WorkspaceBillingEntity, {
      where: { workspaceId },
    });

    if (
      !billing?.creemSubscriptionId ||
      !billing.creemProductId ||
      billing.plan !== "team" ||
      (billing.status !== "active" && billing.status !== "trialing")
    ) {
      return;
    }

    const members = await manager.countBy(WorkspaceUserEntity, { workspaceId });
    const seats = Math.max(1, members);
    if (seats === billing.seats) {
      return;
    }

    // The provider is updated first: a stored count it never accepted would
    // hide the drift from seat reconciliation.
    await this.creem.updateSubscriptionSeats({
      subscriptionId: billing.creemSubscriptionId,
      productId: billing.creemProductId,
      units: seats,
    });

    await updateReturning(
      manager,
      WorkspaceBillingEntity,
      { seats },
      { workspaceId },
    );
  }
}
