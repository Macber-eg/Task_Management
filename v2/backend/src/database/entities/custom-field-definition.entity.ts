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
import { CustomFieldValueEntity } from "./custom-field-value.entity";
import { ProjectEntity } from "./project.entity";

@Entity({ name: "custom_field_definition" })
export class CustomFieldDefinitionEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "type", type: "text" })
  type: string;

  @Column({ name: "required", type: "boolean", default: false })
  required: boolean;

  @Column({ name: "default_value", type: "text", nullable: true })
  defaultValue: string | null;

  @Column({ name: "options", type: "jsonb", nullable: true })
  options: unknown;

  @Column({ name: "position", type: "integer", default: 0 })
  position: number;

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
    () => CustomFieldValueEntity,
    (customFieldValue) => customFieldValue.field,
  )
  values?: Relation<CustomFieldValueEntity[]>;
}
