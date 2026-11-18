import { Column, Entity, PrimaryColumn } from "typeorm";
import type { ImportRunProject } from "./types/import-run-project";

@Entity({ name: "import_run" })
export class ImportRunEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @Column({ name: "user_id", type: "text", nullable: true })
  userId: string | null;

  @Column({ name: "source", type: "text" })
  source: string;

  @Column({ name: "status", type: "text", default: "running" })
  status: string;

  @Column({ name: "include_comments", type: "boolean", default: true })
  includeComments: boolean;

  @Column({ name: "message", type: "text", nullable: true })
  message: string | null;

  @Column({ name: "projects", type: "jsonb" })
  projects: ImportRunProject[];

  @Column({ name: "error", type: "text", nullable: true })
  error: string | null;

  @Column({
    name: "heartbeat_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  heartbeatAt: Date;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;

  @Column({ name: "finished_at", type: "timestamp", nullable: true })
  finishedAt: Date | null;
}
