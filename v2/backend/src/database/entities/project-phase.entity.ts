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
import { ProjectSprintEntity } from "./project-sprint.entity";
import { ProjectEntity } from "./project.entity";
import { TaskEntity } from "./task.entity";

@Entity({ name: "project_phase" })
export class ProjectPhaseEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.phases, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "parent_id", type: "text", nullable: true })
  parentId: string | null;

  @ManyToOne(
    () => ProjectPhaseEntity,
    (projectPhase) => projectPhase.children,
    { nullable: true, onDelete: "CASCADE", onUpdate: "CASCADE" },
  )
  @JoinColumn({ name: "parent_id", referencedColumnName: "id" })
  parent?: Relation<ProjectPhaseEntity> | null;

  @Column({ name: "kind", type: "text", default: "folder" })
  kind: string;

  @Column({ name: "position", type: "integer", default: 0 })
  position: number;

  @Column({ name: "start_date", type: "timestamp", nullable: true })
  startDate: Date | null;

  @Column({ name: "end_date", type: "timestamp", nullable: true })
  endDate: Date | null;

  @Column({ name: "archived_at", type: "timestamp", nullable: true })
  archivedAt: Date | null;

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

  @OneToMany(() => ProjectPhaseEntity, (projectPhase) => projectPhase.parent)
  children?: Relation<ProjectPhaseEntity[]>;

  @OneToMany(() => ProjectSprintEntity, (projectSprint) => projectSprint.phase)
  sprints?: Relation<ProjectSprintEntity[]>;

  @OneToMany(() => TaskEntity, (task) => task.phase)
  tasks?: Relation<TaskEntity[]>;
}
