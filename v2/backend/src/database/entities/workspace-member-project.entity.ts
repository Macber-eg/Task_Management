import { Column, Entity, PrimaryColumn } from "typeorm";

// Unique: workspace_member_project_workspace_user_project_unique (workspace_id, user_id, project_id)
@Entity({ name: "workspace_member_project" })
export class WorkspaceMemberProjectEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;
}
