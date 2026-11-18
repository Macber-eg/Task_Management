import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: workspace_billing_creem_subscription_id_unique (creem_subscription_id)
// Unique: workspace_billing_workspace_id_unique (workspace_id)
@Entity({ name: "workspace_billing" })
export class WorkspaceBillingEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @Column({ name: "founding_free", type: "boolean", default: false })
  foundingFree: boolean;

  @Column({ name: "trial_ends_at", type: "timestamp", nullable: true })
  trialEndsAt: Date | null;

  @Column({ name: "creem_customer_id", type: "text", nullable: true })
  creemCustomerId: string | null;

  @Column({ name: "creem_subscription_id", type: "text", nullable: true })
  creemSubscriptionId: string | null;

  @Column({ name: "creem_product_id", type: "text", nullable: true })
  creemProductId: string | null;

  @Column({ name: "plan", type: "text", nullable: true })
  plan: string | null;

  @Column({ name: "billing_interval", type: "text", nullable: true })
  billingInterval: string | null;

  @Column({ name: "status", type: "text", nullable: true })
  status: string | null;

  @Column({ name: "seats", type: "integer", default: 1 })
  seats: number;

  @Column({ name: "current_period_end", type: "timestamp", nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ name: "canceled_at", type: "timestamp", nullable: true })
  canceledAt: Date | null;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  updatedAt: Date;
}
