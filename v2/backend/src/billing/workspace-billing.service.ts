import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { TrialGrantEntity } from "../database/entities/trial-grant.entity";
import { WorkspaceBillingEntity } from "../database/entities/workspace-billing.entity";
import { WorkspaceEntity } from "../database/entities/workspace.entity";
import { foundingCutoff, trialDays } from "./billing-config";
import { hashTrialEmail } from "./trial-identity";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A workspace's billing row, created on first use. Trials are granted once
 * per owner (by mailbox), so a new workspace inherits its owner's trial.
 */
@Injectable()
export class WorkspaceBillingService {
  constructor(private readonly dataSource: DataSource) {}

  async getOrCreateWorkspaceBilling(
    workspaceId: string,
  ): Promise<WorkspaceBillingEntity> {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(WorkspaceBillingEntity, {
      where: { workspaceId },
    });
    if (existing) {
      return existing;
    }

    const workspace = await manager.findOne(WorkspaceEntity, {
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }

    const cutoff = foundingCutoff();
    const isFounding = cutoff !== null && workspace.createdAt <= cutoff;
    const trialEndsAt = isFounding
      ? null
      : await this.resolveTrialEndsAt(workspaceId);

    const created = await insertReturning(
      manager,
      WorkspaceBillingEntity,
      { workspaceId, foundingFree: isFounding, trialEndsAt },
      { onConflict: { target: ["workspaceId"] } },
    );
    if (created) {
      return created;
    }

    const raced = await manager.findOne(WorkspaceBillingEntity, {
      where: { workspaceId },
    });
    if (!raced) {
      throw new HTTPException(500, {
        message: "Failed to initialize workspace billing",
      });
    }
    return raced;
  }

  private async resolveTrialEndsAt(workspaceId: string): Promise<Date | null> {
    const [owner] = (await this.dataSource.query(
      `SELECT member.user_id AS "userId", "user".email
       FROM workspace_member AS member
       INNER JOIN "user" ON "user".id = member.user_id
       WHERE member.workspace_id = $1 AND member.role = 'owner'
       LIMIT 1`,
      [workspaceId],
    )) as { userId: string; email: string }[];

    if (!owner) {
      return new Date(Date.now() + trialDays() * DAY_MS);
    }

    const [earlier] = (await this.dataSource.query(
      `SELECT min(billing.trial_ends_at) AS "trialEndsAt"
       FROM workspace_billing AS billing
       INNER JOIN workspace_member AS member
         ON member.workspace_id = billing.workspace_id
       WHERE member.user_id = $1
         AND member.role = 'owner'
         AND billing.trial_ends_at IS NOT NULL`,
      [owner.userId],
    )) as { trialEndsAt: Date | null }[];

    if (earlier?.trialEndsAt) {
      return new Date(earlier.trialEndsAt);
    }

    return this.claimTrial(owner.email);
  }

  // The grant outlives the account, so deleting it and signing up again
  // does not start a second trial.
  private async claimTrial(email: string): Promise<Date> {
    const emailHash = hashTrialEmail(email);
    const trialEndsAt = new Date(Date.now() + trialDays() * DAY_MS);

    const claimed = await insertReturning(
      this.dataSource.manager,
      TrialGrantEntity,
      { emailHash, trialEndsAt },
      { onConflict: { target: ["emailHash"] } },
    );
    if (claimed) {
      return claimed.trialEndsAt;
    }

    const granted = await this.dataSource.manager.findOne(TrialGrantEntity, {
      where: { emailHash },
    });
    return granted?.trialEndsAt ?? trialEndsAt;
  }
}
