import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import { ActivityEntity } from "./activity.entity";
import { ProjectEntity } from "./project.entity";
import { TaskEntity } from "./task.entity";
import { UserEntity } from "./user.entity";
import { WorkspaceEntity } from "./workspace.entity";

// Unique: asset_object_key_unique (object_key)
@Entity({ name: "asset" })
export class AssetEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.assets, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "workspace_id", referencedColumnName: "id" })
  workspace?: Relation<WorkspaceEntity>;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.assets, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "task_id", type: "text", nullable: true })
  taskId: string | null;

  @ManyToOne(() => TaskEntity, (task) => task.assets, {
    nullable: true,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "task_id", referencedColumnName: "id" })
  task?: Relation<TaskEntity> | null;

  @Column({ name: "activity_id", type: "text", nullable: true })
  activityId: string | null;

  @ManyToOne(() => ActivityEntity, {
    nullable: true,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "activity_id", referencedColumnName: "id" })
  activity?: Relation<ActivityEntity> | null;

  @Column({ name: "object_key", type: "text" })
  objectKey: string;

  @Column({ name: "filename", type: "text" })
  filename: string;

  @Column({ name: "mime_type", type: "text" })
  mimeType: string;

  @Column({ name: "size", type: "integer" })
  size: number;

  @Column({ name: "kind", type: "text", default: "image" })
  kind: string;

  @Column({ name: "surface", type: "text", default: "description" })
  surface: string;

  @Column({ name: "created_by", type: "text", nullable: true })
  createdBy: string | null;

  @ManyToOne(() => UserEntity, (user) => user.assets, {
    nullable: true,
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "created_by", referencedColumnName: "id" })
  creator?: Relation<UserEntity> | null;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;
}
