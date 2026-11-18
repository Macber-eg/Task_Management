import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { TaskEntity } from "./task.entity";

// Unique: task_reminder_sent_task_type_unique (task_id, reminder_type)
@Entity({ name: "task_reminder_sent" })
export class TaskReminderSentEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "task_id", type: "text" })
  taskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.remindersSent, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "task_id", referencedColumnName: "id" })
  task?: Relation<TaskEntity>;

  @Column({ name: "reminder_type", type: "text" })
  reminderType: string;

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
