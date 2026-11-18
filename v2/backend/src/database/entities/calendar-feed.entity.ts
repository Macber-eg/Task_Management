import { Column, Entity, PrimaryColumn } from "typeorm";

// Unique: calendar_feed_token_unique (token)
@Entity({ name: "calendar_feed" })
export class CalendarFeedEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @Column({ name: "token", type: "text" })
  token: string;

  @Column({ name: "label_ids", type: "jsonb" })
  labelIds: string[];

  @Column({ name: "time_zone", type: "text", default: "UTC" })
  timeZone: string;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;
}
