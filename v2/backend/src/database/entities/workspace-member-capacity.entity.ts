import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: workspace_member_capacity_workspace_user_unique (workspace_id, user_id); unique index, not constraint
@Entity({ name: "workspace_member_capacity" })
export class WorkspaceMemberCapacityEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "minutes_per_day", type: "integer", default: 480 })
  minutesPerDay: number;

  @Column({ name: "working_days_per_week", type: "integer", default: 5 })
  workingDaysPerWeek: number;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(timezone('utc', now()))",
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamp",
    default: () => "(timezone('utc', now()))",
  })
  updatedAt: Date;
}
