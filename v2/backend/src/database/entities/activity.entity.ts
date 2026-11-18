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

// Unique: activity_task_external_source_external_url_unique (task_id, external_source, external_url)
@Entity({ name: "activity" })
export class ActivityEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "task_id", type: "text" })
  taskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.activities, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "task_id", referencedColumnName: "id" })
  task?: Relation<TaskEntity>;

  @Column({ name: "type", type: "text" })
  type: string;

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

  @Column({ name: "user_id", type: "text", nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, (user) => user.activities, {
    nullable: true,
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity> | null;

  @Column({ name: "content", type: "text", nullable: true })
  content: string | null;

  @Column({ name: "event_data", type: "jsonb", nullable: true })
  eventData: unknown;

  @Column({ name: "external_user_name", type: "text", nullable: true })
  externalUserName: string | null;

  @Column({ name: "external_user_avatar", type: "text", nullable: true })
  externalUserAvatar: string | null;

  @Column({ name: "external_source", type: "text", nullable: true })
  externalSource: string | null;

  @Column({ name: "external_url", type: "text", nullable: true })
  externalUrl: string | null;
}
