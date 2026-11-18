import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: mcp_oauth_state_kind_key_uidx (kind, key); unique index, not constraint
@Entity({ name: "mcp_oauth_state" })
export class McpOauthStateEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "kind", type: "text" })
  kind: string;

  @Column({ name: "key", type: "text" })
  key: string;

  @Column({ name: "payload", type: "jsonb" })
  payload: unknown;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

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
