import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { ProjectEntity } from "./project.entity";
import { UserNotificationWorkspaceRuleEntity } from "./user-notification-workspace-rule.entity";

// Unique: user_notification_workspace_project_rule_project_unique (workspace_rule_id, project_id)
@Entity({ name: "user_notification_workspace_project" })
export class UserNotificationWorkspaceProjectEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @Column({ name: "workspace_rule_id", type: "text" })
  workspaceRuleId: string;

  @ManyToOne(
    () => UserNotificationWorkspaceRuleEntity,
    (userNotificationWorkspaceRule) =>
      userNotificationWorkspaceRule.selectedProjects,
    { nullable: false, onDelete: "CASCADE", onUpdate: "CASCADE" },
  )
  @JoinColumn({ name: "workspace_rule_id", referencedColumnName: "id" })
  workspaceRule?: Relation<UserNotificationWorkspaceRuleEntity>;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(
    () => ProjectEntity,
    (project) => project.notificationWorkspaceProjects,
    { nullable: false, onDelete: "CASCADE", onUpdate: "CASCADE" },
  )
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

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
