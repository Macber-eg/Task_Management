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
import { ProjectPhaseEntity } from "./project-phase.entity";
import { ProjectEntity } from "./project.entity";
import { TaskEntity } from "./task.entity";

@Entity({ name: "project_sprint" })
export class ProjectSprintEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.sprints, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "phase_id", type: "text", nullable: true })
  phaseId: string | null;

  @ManyToOne(() => ProjectPhaseEntity, (projectPhase) => projectPhase.sprints, {
    nullable: true,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "phase_id", referencedColumnName: "id" })
  phase?: Relation<ProjectPhaseEntity> | null;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "goal", type: "text", nullable: true })
  goal: string | null;

  @Column({ name: "status", type: "text", default: "planned" })
  status: string;

  @Column({ name: "position", type: "integer", default: 0 })
  position: number;

  @Column({ name: "start_date", type: "timestamp", nullable: true })
  startDate: Date | null;

  @Column({ name: "end_date", type: "timestamp", nullable: true })
  endDate: Date | null;

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

  @OneToMany(() => TaskEntity, (task) => task.sprint)
  tasks?: Relation<TaskEntity[]>;
}
