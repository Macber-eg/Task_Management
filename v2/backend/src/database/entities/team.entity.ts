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
import { TeamMemberEntity } from "./team-member.entity";
import { WorkspaceEntity } from "./workspace.entity";

@Entity({ name: "team" })
export class TeamEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "workspace_id", type: "text" })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.teams, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "workspace_id", referencedColumnName: "id" })
  workspace?: Relation<WorkspaceEntity>;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", nullable: true })
  updatedAt: Date | null;

  @OneToMany(() => TeamMemberEntity, (teamMember) => teamMember.team)
  teamMembers?: Relation<TeamMemberEntity[]>;
}
