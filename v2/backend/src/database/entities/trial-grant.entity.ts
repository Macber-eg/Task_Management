import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "trial_grant" })
export class TrialGrantEntity {
  @PrimaryColumn({ name: "email_hash", type: "text" })
  emailHash: string;

  @Column({ name: "trial_ends_at", type: "timestamp" })
  trialEndsAt: Date;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;
}
