import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import { TaskEntity } from "./task.entity";

@Entity({ name: "task_relation" })
export class TaskRelationEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "source_task_id", type: "text" })
  sourceTaskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.sourceRelations, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "source_task_id", referencedColumnName: "id" })
  sourceTask?: Relation<TaskEntity>;

  @Column({ name: "target_task_id", type: "text" })
  targetTaskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.targetRelations, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "target_task_id", referencedColumnName: "id" })
  targetTask?: Relation<TaskEntity>;

  @Column({ name: "relation_type", type: "text" })
  relationType: string;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;
}
