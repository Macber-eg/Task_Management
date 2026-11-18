import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "time_entry_audit" })
export class TimeEntryAuditEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "time_entry_id", type: "text" })
  timeEntryId: string;

  @Column({ name: "task_id", type: "text" })
  taskId: string;

  @Column({ name: "actor_user_id", type: "text", nullable: true })
  actorUserId: string | null;

  @Column({ name: "action", type: "text" })
  action: string;

  @Column({ name: "before_data", type: "jsonb", nullable: true })
  beforeData: unknown;

  @Column({ name: "after_data", type: "jsonb", nullable: true })
  afterData: unknown;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(timezone('utc', now()))",
  })
  createdAt: Date;
}
