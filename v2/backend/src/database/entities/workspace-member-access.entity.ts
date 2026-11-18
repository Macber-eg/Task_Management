import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: workspace_member_access_workspace_user_unique (workspace_id, user_id)
@Entity({ name: "workspace_member_access" })
export class WorkspaceMemberAccessEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "project_access", type: "text", default: "all" })
  projectAccess: string;

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
