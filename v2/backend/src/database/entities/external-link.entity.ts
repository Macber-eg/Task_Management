import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { IntegrationEntity } from "./integration.entity";
import { TaskEntity } from "./task.entity";

@Entity({ name: "external_link" })
export class ExternalLinkEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "task_id", type: "text" })
  taskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.externalLinks, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "task_id", referencedColumnName: "id" })
  task?: Relation<TaskEntity>;

  @Column({ name: "integration_id", type: "text", nullable: true })
  integrationId: string | null;

  @ManyToOne(
    () => IntegrationEntity,
    (integration) => integration.externalLinks,
    { nullable: true, onDelete: "CASCADE", onUpdate: "CASCADE" },
  )
  @JoinColumn({ name: "integration_id", referencedColumnName: "id" })
  integration?: Relation<IntegrationEntity> | null;

  @Column({ name: "resource_type", type: "text" })
  resourceType: string;

  @Column({ name: "external_id", type: "text" })
  externalId: string;

  @Column({ name: "url", type: "text" })
  url: string;

  @Column({ name: "title", type: "text", nullable: true })
  title: string | null;

  @Column({ name: "metadata", type: "text", nullable: true })
  metadata: string | null;

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
