import {
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import { AssetEntity } from "./asset.entity";
import { InvitationEntity } from "./invitation.entity";
import { ProjectEntity } from "./project.entity";
import { TeamEntity } from "./team.entity";
import { UserNotificationWorkspaceRuleEntity } from "./user-notification-workspace-rule.entity";
import { WorkspaceUserEntity } from "./workspace-user.entity";

// Unique: workspace_slug_unique (slug)
@Entity({ name: "workspace" })
export class WorkspaceEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "slug", type: "text" })
  slug: string;

  @Column({ name: "logo", type: "text", nullable: true })
  logo: string | null;

  @Column({ name: "metadata", type: "text", nullable: true })
  metadata: string | null;

  @Column({ name: "description", type: "text", nullable: true })
  description: string | null;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt: Date;

  @OneToMany(() => TeamEntity, (team) => team.workspace)
  teams?: Relation<TeamEntity[]>;

  @OneToMany(
    () => WorkspaceUserEntity,
    (workspaceUser) => workspaceUser.workspace,
  )
  members?: Relation<WorkspaceUserEntity[]>;

  @OneToMany(() => ProjectEntity, (project) => project.workspace)
  projects?: Relation<ProjectEntity[]>;

  @OneToMany(() => AssetEntity, (asset) => asset.workspace)
  assets?: Relation<AssetEntity[]>;

  @OneToMany(() => InvitationEntity, (invitation) => invitation.workspace)
  invitations?: Relation<InvitationEntity[]>;

  @OneToMany(
    () => UserNotificationWorkspaceRuleEntity,
    (userNotificationWorkspaceRule) => userNotificationWorkspaceRule.workspace,
  )
  notificationWorkspaceRules?: Relation<UserNotificationWorkspaceRuleEntity[]>;
}
