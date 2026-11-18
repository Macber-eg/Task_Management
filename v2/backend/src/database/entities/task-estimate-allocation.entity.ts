import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: task_estimate_allocation_task_user_unique (task_id, user_id); unique index, not constraint
@Entity({ name: "task_estimate_allocation" })
export class TaskEstimateAllocationEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "task_id", type: "text" })
  taskId: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "estimated_minutes", type: "integer", default: 0 })
  estimatedMinutes: number;

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
