import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import { UserEntity } from "./user.entity";
import { WorkspaceEntity } from "./workspace.entity";

@Entity({ name: "invitation" })
export class InvitationEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.invitations, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "workspace_id", referencedColumnName: "id" })
  workspace?: Relation<WorkspaceEntity>;

  @Column({ name: "email", type: "text" })
  email: string;

  @Column({ name: "role", type: "text", nullable: true })
  role: string | null;

  @Column({ name: "team_id", type: "text", nullable: true })
  teamId: string | null;

  @Column({ name: "status", type: "text", default: "pending" })
  status: string;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;

  @Column({ name: "inviter_id", type: "text" })
  inviterId: string;

  @ManyToOne(() => UserEntity, (user) => user.sentInvitations, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "inviter_id", referencedColumnName: "id" })
  inviter?: Relation<UserEntity>;

  @Column({ name: "project_access", type: "text", default: "all" })
  projectAccess: string;

  @Column({
    name: "project_ids",
    type: "text",
    array: true,
    default: () => "'{}'::text[]",
  })
  projectIds: string[];
}
