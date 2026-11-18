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
import { ExternalLinkEntity } from "./external-link.entity";
import { ProjectEntity } from "./project.entity";

// Unique: integration_project_type_unique (project_id, type)
@Entity({ name: "integration" })
export class IntegrationEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.integrations, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "project_id", referencedColumnName: "id" })
  project?: Relation<ProjectEntity>;

  @Column({ name: "type", type: "text" })
  type: string;

  @Column({ name: "config", type: "text" })
  config: string;

  @Column({ name: "is_active", type: "boolean", nullable: true, default: true })
  isActive: boolean | null;

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
    () => ExternalLinkEntity,
    (externalLink) => externalLink.integration,
  )
  externalLinks?: Relation<ExternalLinkEntity[]>;
}
