import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { GitHubImportState } from "./types/github-import-state";

@Entity({ name: "github_import" })
export class GithubImportEntity {
  @PrimaryColumn({ name: "integration_id", type: "text" })
  integrationId: string;

  @Column({ name: "run_id", type: "text" })
  runId: string; // app default: createId()

  @Column({ name: "state", type: "jsonb" })
  state: GitHubImportState;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  updatedAt: Date;
}
