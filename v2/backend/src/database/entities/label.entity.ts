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

// Unique: label_task_name_unique (task_id, name)
// Unique: label_workspace_name_unique (workspace_id, name) WHERE (task_id IS NULL); unique index, not constraint
@Entity({ name: "label" })
export class LabelEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "color", type: "text" })
  color: string;

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

  @Column({ name: "deletion_started_at", type: "timestamp", nullable: true })
  deletionStartedAt: Date | null;

  @Column({ name: "task_id", type: "text", nullable: true })
  taskId: string | null;

  @ManyToOne(() => TaskEntity, (task) => task.labels, {
    nullable: true,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "task_id", referencedColumnName: "id" })
  task?: Relation<TaskEntity> | null;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;
}
