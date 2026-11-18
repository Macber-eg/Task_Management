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
import { ActivityEntity } from "./activity.entity";
import { AssetEntity } from "./asset.entity";
import { ColumnEntity } from "./column.entity";
import { CommentEntity } from "./comment.entity";
import { CustomFieldValueEntity } from "./custom-field-value.entity";
import { ExternalLinkEntity } from "./external-link.entity";
import { LabelEntity } from "./label.entity";
import { ProjectPhaseEntity } from "./project-phase.entity";
import { ProjectSprintEntity } from "./project-sprint.entity";
import { ProjectEntity } from "./project.entity";
import { TaskRelationEntity } from "./task-relation.entity";
import { TaskReminderSentEntity } from "./task-reminder-sent.entity";
import { TimeEntryEntity } from "./time-entry.entity";
import { UserEntity } from "./user.entity";

// Unique: task_project_number_unique (project_id, number)
@Entity({ name: "task" })
export class TaskEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.tasks, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "position", type: "integer", nullable: true, default: 0 })
  position: number | null;

  @Column({ name: "number", type: "integer", nullable: true, default: 1 })
  number: number | null;

  @Column({ name: "assignee_id", type: "text", nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, (user) => user.assignedTasks, {
    nullable: true,
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "assignee_id", referencedColumnName: "id" })
  assignee?: Relation<UserEntity> | null;

  @Column({ name: "title", type: "text" })
  title: string;

  @Column({ name: "description", type: "text", nullable: true })
  description: string | null;

  @Column({ name: "status", type: "text", default: "to-do" })
  status: string;

  @Column({ name: "column_id", type: "text", nullable: true })
  columnId: string | null;

  @ManyToOne(() => ColumnEntity, (column) => column.tasks, {
    nullable: true,
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "column_id", referencedColumnName: "id" })
  column?: Relation<ColumnEntity> | null;

  @Column({ name: "phase_id", type: "text", nullable: true })
  phaseId: string | null;

  @ManyToOne(() => ProjectPhaseEntity, (projectPhase) => projectPhase.tasks, {
    nullable: true,
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "phase_id", referencedColumnName: "id" })
  phase?: Relation<ProjectPhaseEntity> | null;

  @Column({ name: "sprint_id", type: "text", nullable: true })
  sprintId: string | null;

  @ManyToOne(
    () => ProjectSprintEntity,
    (projectSprint) => projectSprint.tasks,
    { nullable: true, onDelete: "SET NULL", onUpdate: "CASCADE" },
  )
  @JoinColumn({ name: "sprint_id", referencedColumnName: "id" })
  sprint?: Relation<ProjectSprintEntity> | null;

  @Column({ name: "priority", type: "text", default: "low" })
  priority: string;

  @Column({ name: "start_date", type: "timestamp", nullable: true })
  startDate: Date | null;

  @Column({ name: "due_date", type: "timestamp", nullable: true })
  dueDate: Date | null;

  @Column({ name: "estimated_minutes", type: "integer", nullable: true })
  estimatedMinutes: number | null;

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

  @OneToMany(() => TimeEntryEntity, (timeEntry) => timeEntry.task)
  timeEntries?: Relation<TimeEntryEntity[]>;

  @OneToMany(() => ActivityEntity, (activity) => activity.task)
  activities?: Relation<ActivityEntity[]>;

  @OneToMany(() => CommentEntity, (comment) => comment.task)
  comments?: Relation<CommentEntity[]>;

  @OneToMany(() => AssetEntity, (asset) => asset.task)
  assets?: Relation<AssetEntity[]>;

  @OneToMany(() => LabelEntity, (label) => label.task)
  labels?: Relation<LabelEntity[]>;

  @OneToMany(() => ExternalLinkEntity, (externalLink) => externalLink.task)
  externalLinks?: Relation<ExternalLinkEntity[]>;

  @OneToMany(
    () => TaskRelationEntity,
    (taskRelation) => taskRelation.sourceTask,
  )
  sourceRelations?: Relation<TaskRelationEntity[]>;

  @OneToMany(
    () => TaskRelationEntity,
    (taskRelation) => taskRelation.targetTask,
  )
  targetRelations?: Relation<TaskRelationEntity[]>;

  @OneToMany(
    () => TaskReminderSentEntity,
    (taskReminderSent) => taskReminderSent.task,
  )
  remindersSent?: Relation<TaskReminderSentEntity[]>;

  @OneToMany(
    () => CustomFieldValueEntity,
    (customFieldValue) => customFieldValue.task,
  )
  customFieldValues?: Relation<CustomFieldValueEntity[]>;
}
