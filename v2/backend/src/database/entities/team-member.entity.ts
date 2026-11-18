import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import { TeamEntity } from "./team.entity";
import { UserEntity } from "./user.entity";

@Entity({ name: "team_member" })
export class TeamMemberEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "team_id", type: "text" })
  teamId: string;

  @ManyToOne(() => TeamEntity, (team) => team.teamMembers, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "team_id", referencedColumnName: "id" })
  team?: Relation<TeamEntity>;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @ManyToOne(() => UserEntity, (user) => user.teamMembers, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "created_at", type: "timestamp", nullable: true })
  createdAt: Date | null;
}
