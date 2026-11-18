import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: billing_reminder_sent_user_type_unique (user_id, reminder_type)
@Entity({ name: "billing_reminder_sent" })
export class BillingReminderSentEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @Column({ name: "reminder_type", type: "text" })
  reminderType: string;

  @Column({ name: "trial_ends_at", type: "timestamp", nullable: true })
  trialEndsAt: Date | null;

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
