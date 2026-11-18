import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { UserNotificationWorkspaceProjectEntity } from "./user-notification-workspace-project.entity";
import { UserEntity } from "./user.entity";
import { WorkspaceEntity } from "./workspace.entity";

// Unique: user_notification_workspace_rule_user_workspace_unique (user_id, workspace_id)
// Unique: user_notification_workspace_rule_workspace_id_id_unique (workspace_id, id)
@Entity({ name: "user_notification_workspace_rule" })
export class UserNotificationWorkspaceRuleEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @ManyToOne(() => UserEntity, (user) => user.notificationWorkspaceRules, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @ManyToOne(
    () => WorkspaceEntity,
    (workspace) => workspace.notificationWorkspaceRules,
    { nullable: false, onDelete: "CASCADE", onUpdate: "CASCADE" },
  )
  @JoinColumn({ name: "workspace_id", referencedColumnName: "id" })
  workspace?: Relation<WorkspaceEntity>;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ name: "email_enabled", type: "boolean", default: false })
  emailEnabled: boolean;

  @Column({ name: "ntfy_enabled", type: "boolean", default: false })
  ntfyEnabled: boolean;

  @Column({ name: "gotify_enabled", type: "boolean", default: false })
  gotifyEnabled: boolean;

  @Column({ name: "webhook_enabled", type: "boolean", default: false })
  webhookEnabled: boolean;

  @Column({ name: "project_mode", type: "text", default: "all" })
  projectMode: string;

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

  @OneToMany(
    () => UserNotificationWorkspaceProjectEntity,
    (userNotificationWorkspaceProject) =>
      userNotificationWorkspaceProject.workspaceRule,
  )
  selectedProjects?: Relation<UserNotificationWorkspaceProjectEntity[]>;
}
