import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { UserEntity } from "./user.entity";

// Unique: user_notification_preference_user_id_unique (user_id)
@Entity({ name: "user_notification_preference" })
export class UserNotificationPreferenceEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @OneToOne(() => UserEntity, (user) => user.notificationPreference, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "email_enabled", type: "boolean", default: false })
  emailEnabled: boolean;

  @Column({ name: "ntfy_enabled", type: "boolean", default: false })
  ntfyEnabled: boolean;

  @Column({ name: "ntfy_server_url", type: "text", nullable: true })
  ntfyServerUrl: string | null;

  @Column({ name: "ntfy_topic", type: "text", nullable: true })
  ntfyTopic: string | null;

  @Column({ name: "ntfy_token", type: "text", nullable: true })
  ntfyToken: string | null;

  @Column({ name: "gotify_enabled", type: "boolean", default: false })
  gotifyEnabled: boolean;

  @Column({ name: "gotify_server_url", type: "text", nullable: true })
  gotifyServerUrl: string | null;

  @Column({ name: "gotify_token", type: "text", nullable: true })
  gotifyToken: string | null;

  @Column({ name: "webhook_enabled", type: "boolean", default: false })
  webhookEnabled: boolean;

  @Column({ name: "webhook_url", type: "text", nullable: true })
  webhookUrl: string | null;

  @Column({ name: "webhook_secret", type: "text", nullable: true })
  webhookSecret: string | null;

  @Column({ name: "task_assignment_enabled", type: "boolean", default: true })
  taskAssignmentEnabled: boolean;

  @Column({ name: "task_comment_enabled", type: "boolean", default: true })
  taskCommentEnabled: boolean;

  @Column({
    name: "task_status_change_enabled",
    type: "boolean",
    default: true,
  })
  taskStatusChangeEnabled: boolean;

  @Column({ name: "due_date_reminder_enabled", type: "boolean", default: true })
  dueDateReminderEnabled: boolean;

  @Column({
    name: "due_date_reminder_lead_time_minutes",
    type: "integer",
    default: 1440,
  })
  dueDateReminderLeadTimeMinutes: number;

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
