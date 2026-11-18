import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { ColumnEntity } from "./column.entity";
import { ProjectEntity } from "./project.entity";

@Entity({ name: "workflow_rule" })
export class WorkflowRuleEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.workflowRules, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "integration_type", type: "text" })
  integrationType: string;

  @Column({ name: "event_type", type: "text" })
  eventType: string;

  @Column({ name: "column_id", type: "text" })
  columnId: string;

  @ManyToOne(() => ColumnEntity, (column) => column.workflowRules, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "column_id", referencedColumnName: "id" })
  column?: Relation<ColumnEntity>;

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
