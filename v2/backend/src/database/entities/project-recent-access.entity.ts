import { Column, Entity, PrimaryColumn } from "typeorm";

// Unique: project_recent_access_unique (project_id, user_id, item_type, item_id); unique index, not constraint
@Entity({ name: "project_recent_access" })
export class ProjectRecentAccessEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "item_type", type: "text" })
  itemType: string;

  @Column({ name: "item_id", type: "text" })
  itemId: string;

  @Column({ name: "title", type: "text" })
  title: string;

  @Column({ name: "parent_label", type: "text", nullable: true })
  parentLabel: string | null;

  @Column({
    name: "accessed_at",
    type: "timestamp",
    default: () => "(timezone('utc', now()))",
  })
  accessedAt: Date;
}
