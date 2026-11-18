import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { UserEntity } from "./user.entity";

// Unique: session_token_unique (token)
@Entity({ name: "session" })
export class SessionEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  @Column({ name: "token", type: "text" })
  token: string;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updatedAt: Date;

  @Column({ name: "ip_address", type: "text", nullable: true })
  ipAddress: string | null;

  @Column({ name: "user_agent", type: "text", nullable: true })
  userAgent: string | null;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @ManyToOne(() => UserEntity, (user) => user.sessions, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "active_organization_id", type: "text", nullable: true })
  activeOrganizationId: string | null;

  @Column({ name: "active_team_id", type: "text", nullable: true })
  activeTeamId: string | null;

  @Column({ name: "impersonated_by", type: "text", nullable: true })
  impersonatedBy: string | null;

  @Column({ name: "kind", type: "text", default: "browser" })
  kind: string;

  @Column({ name: "previous_token", type: "text", nullable: true })
  previousToken: string | null;

  @Column({ name: "rotated_at", type: "timestamp", nullable: true })
  rotatedAt: Date | null;
}
