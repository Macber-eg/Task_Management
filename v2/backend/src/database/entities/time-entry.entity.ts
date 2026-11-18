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
import { UserEntity } from "./user.entity";

@Entity({ name: "time_entry" })
export class TimeEntryEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "task_id", type: "text" })
  taskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.timeEntries, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "task_id", referencedColumnName: "id" })
  task?: Relation<TaskEntity>;

  @Column({ name: "user_id", type: "text", nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, (user) => user.timeEntries, {
    nullable: true,
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity> | null;

  @Column({ name: "description", type: "text", nullable: true })
  description: string | null;

  @Column({ name: "start_time", type: "timestamp" })
  startTime: Date;

  @Column({ name: "end_time", type: "timestamp", nullable: true })
  endTime: Date | null;

  @Column({ name: "duration", type: "integer", nullable: true, default: 0 })
  duration: number | null;

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
