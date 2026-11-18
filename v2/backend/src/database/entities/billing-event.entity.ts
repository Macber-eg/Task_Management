import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "billing_event" })
export class BillingEventEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "event_type", type: "text" })
  eventType: string;

  @Column({
    name: "processed_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  processedAt: Date;
}
