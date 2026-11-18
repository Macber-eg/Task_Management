import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { JobScheduler } from "../../scheduler/job-scheduler";
import { JobLease } from "../../scheduler/leader-lock";
import { isBillingEnabled } from "../billing-config";
import { SeatSyncService } from "../seat-sync.service";

export const SEAT_RECONCILIATION_LEASE = "seat-reconciliation";

const BATCH_SIZE = 100;

/**
 * Repairs team subscriptions whose seat count drifted from the membership,
 * e.g. after a seat sync failed. One replica at a time.
 */
@Injectable()
export class SeatReconciliation implements OnModuleInit {
  private readonly logger = new Logger(SeatReconciliation.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly seats: SeatSyncService,
    private readonly lease: JobLease,
    private readonly scheduler: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "seat-reconciliation",
      cron: "17 * * * *",
      run: () => this.reconcileWorkspaceSeats(),
    });
  }

  async reconcileWorkspaceSeats(): Promise<{ degraded: boolean }> {
    if (!isBillingEnabled()) {
      return { degraded: false };
    }

    return this.lease.withJobLease(
      SEAT_RECONCILIATION_LEASE,
      () => this.runReconciliation(),
      () => ({ degraded: false }),
    );
  }

  private findDriftedWorkspaces(): Promise<{ workspaceId: string }[]> {
    return this.dataSource.query(
      `SELECT billing.workspace_id AS "workspaceId"
       FROM workspace_billing AS billing
       INNER JOIN workspace_member AS member
         ON member.workspace_id = billing.workspace_id
       WHERE billing.plan = 'team'
         AND billing.status IN ('active', 'trialing')
         AND billing.creem_subscription_id IS NOT NULL
         AND billing.creem_product_id IS NOT NULL
       GROUP BY billing.workspace_id, billing.seats
       HAVING count(member.user_id) <> billing.seats
       LIMIT $1`,
      [BATCH_SIZE],
    ) as Promise<{ workspaceId: string }[]>;
  }

  private async runReconciliation(): Promise<{ degraded: boolean }> {
    let drifted: { workspaceId: string }[];
    try {
      drifted = await this.findDriftedWorkspaces();
    } catch (error) {
      this.logger.error("billing: seat reconciliation query failed", error);
      return { degraded: true };
    }

    if (drifted.length === 0) {
      return { degraded: false };
    }

    let repaired = 0;
    let degraded = false;
    for (const { workspaceId } of drifted) {
      try {
        await this.seats.syncWorkspaceSeats(workspaceId);
        repaired += 1;
      } catch (error) {
        degraded = true;
        this.logger.error(
          `billing: seat reconciliation failed for workspace ${workspaceId}`,
          error,
        );
      }
    }

    this.logger.log(
      `billing: seat reconciliation resynced ${repaired}/${drifted.length} workspaces`,
    );
    return { degraded };
  }
}
