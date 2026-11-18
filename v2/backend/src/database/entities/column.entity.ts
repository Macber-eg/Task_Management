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
import { ProjectEntity } from "./project.entity";
import { TaskEntity } from "./task.entity";
import { WorkflowRuleEntity } from "./workflow-rule.entity";

@Entity({ name: "column" })
export class ColumnEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.columns, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "slug", type: "text" })
  slug: string;

  @Column({ name: "position", type: "integer", default: 0 })
  position: number;

  @Column({ name: "icon", type: "text", nullable: true })
  icon: string | null;

  @Column({ name: "color", type: "text", nullable: true })
  color: string | null;

  @Column({ name: "is_final", type: "boolean", default: false })
  isFinal: boolean;

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

  @OneToMany(() => TaskEntity, (task) => task.column)
  tasks?: Relation<TaskEntity[]>;

  @OneToMany(() => WorkflowRuleEntity, (workflowRule) => workflowRule.column)
  workflowRules?: Relation<WorkflowRuleEntity[]>;
}
