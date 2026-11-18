import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { CustomFieldDefinitionEntity } from "./custom-field-definition.entity";
import { TaskEntity } from "./task.entity";

// Unique: custom_field_value_task_field_unique (task_id, field_id)
@Entity({ name: "custom_field_value" })
export class CustomFieldValueEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "task_id", type: "text" })
  taskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.customFieldValues, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "task_id", referencedColumnName: "id" })
  task?: Relation<TaskEntity>;

  @Column({ name: "field_id", type: "text" })
  fieldId: string;

  @ManyToOne(
    () => CustomFieldDefinitionEntity,
    (customFieldDefinition) => customFieldDefinition.values,
    { nullable: false, onDelete: "CASCADE", onUpdate: "CASCADE" },
  )
  @JoinColumn({ name: "field_id", referencedColumnName: "id" })
  field?: Relation<CustomFieldDefinitionEntity>;

  @Column({ name: "value", type: "text", nullable: true })
  value: string | null;

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
