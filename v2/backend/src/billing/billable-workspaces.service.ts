import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { isBillingEnabled } from "./billing-config";
import {
  hasBillableSubscription,
  type SubscriptionState,
} from "./subscription-state";

/** Workspaces that must not be deleted until their subscription is cancelled. */
@Injectable()
export class BillableWorkspacesService {
  constructor(private readonly dataSource: DataSource) {}

  async findBillableWorkspaces(
    workspaceIds: string[],
  ): Promise<{ workspaceId: string; name: string }[]> {
    if (!isBillingEnabled() || workspaceIds.length === 0) {
      return [];
    }

    const rows = (await this.dataSource.query(
      `SELECT billing.workspace_id AS "workspaceId", workspace.name,
              billing.creem_subscription_id AS "creemSubscriptionId",
              billing.status
       FROM workspace_billing AS billing
       INNER JOIN workspace ON workspace.id = billing.workspace_id
       WHERE billing.workspace_id = ANY($1::text[])`,
      [workspaceIds],
    )) as (SubscriptionState & { workspaceId: string; name: string })[];

    return rows
      .filter(hasBillableSubscription)
      .map((row) => ({ workspaceId: row.workspaceId, name: row.name }));
  }
}
