import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import { AssetEntity } from "./asset.entity";
import { ColumnEntity } from "./column.entity";
import { IntegrationEntity } from "./integration.entity";
import { ProjectPhaseEntity } from "./project-phase.entity";
import { ProjectSprintEntity } from "./project-sprint.entity";
import { TaskEntity } from "./task.entity";
import { UserNotificationWorkspaceProjectEntity } from "./user-notification-workspace-project.entity";
import { WorkflowRuleEntity } from "./workflow-rule.entity";
import { WorkspaceEntity } from "./workspace.entity";

// Unique: project_workspace_id_id_unique (workspace_id, id)
@Entity({ name: "project" })
export class ProjectEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.projects, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "workspace_id", referencedColumnName: "id" })
  workspace?: Relation<WorkspaceEntity>;

  @Column({ name: "slug", type: "text" })
  slug: string;

  @Column({ name: "icon", type: "text", nullable: true, default: "Layout" })
  icon: string | null;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "description", type: "text", nullable: true })
  description: string | null;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;

  @Column({
    name: "is_public",
    type: "boolean",
    nullable: true,
    default: false,
  })
  isPublic: boolean | null;

  @Column({ name: "archived_at", type: "timestamp", nullable: true })
  archivedAt: Date | null;

  @Column({ name: "last_task_number", type: "integer", default: 0 })
  lastTaskNumber: number;

  @Column({ name: "position", type: "integer", default: 0 })
  position: number;

  @Column({ name: "background_object_key", type: "text", nullable: true })
  backgroundObjectKey: string | null;

  @Column({ name: "background_mime_type", type: "text", nullable: true })
  backgroundMimeType: string | null;

  @Column({ name: "background_version", type: "text", nullable: true })
  backgroundVersion: string | null;

  @Column({ name: "phases_enabled", type: "boolean", default: false })
  phasesEnabled: boolean;

  @Column({ name: "sprints_enabled", type: "boolean", default: false })
  sprintsEnabled: boolean;

  @Column({ name: "start_date", type: "timestamp", nullable: true })
  startDate: Date | null;

  @Column({ name: "end_date", type: "timestamp", nullable: true })
  endDate: Date | null;

  @OneToMany(() => TaskEntity, (task) => task.project)
  tasks?: Relation<TaskEntity[]>;

  @OneToMany(() => AssetEntity, (asset) => asset.project)
  assets?: Relation<AssetEntity[]>;

  @OneToMany(() => ColumnEntity, (column) => column.project)
  columns?: Relation<ColumnEntity[]>;

  @OneToMany(() => ProjectPhaseEntity, (projectPhase) => projectPhase.project)
  phases?: Relation<ProjectPhaseEntity[]>;

  @OneToMany(
    () => ProjectSprintEntity,
    (projectSprint) => projectSprint.project,
  )
  sprints?: Relation<ProjectSprintEntity[]>;

  @OneToMany(() => WorkflowRuleEntity, (workflowRule) => workflowRule.project)
  workflowRules?: Relation<WorkflowRuleEntity[]>;

  @OneToMany(() => IntegrationEntity, (integration) => integration.project)
  integrations?: Relation<IntegrationEntity[]>;

  @OneToMany(
    () => UserNotificationWorkspaceProjectEntity,
    (userNotificationWorkspaceProject) =>
      userNotificationWorkspaceProject.project,
  )
  notificationWorkspaceProjects?: Relation<
    UserNotificationWorkspaceProjectEntity[]
  >;
}
