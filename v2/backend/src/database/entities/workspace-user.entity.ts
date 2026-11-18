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

@Entity({ name: "workspace_member" })
export class WorkspaceUserEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.members, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "workspace_id", referencedColumnName: "id" })
  workspace?: Relation<WorkspaceEntity>;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @ManyToOne(() => UserEntity, (user) => user.workspaceMemberships, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "role", type: "text", default: "member" })
  role: string;

  @Column({ name: "joined_at", type: "timestamp" })
  joinedAt: Date;
}
