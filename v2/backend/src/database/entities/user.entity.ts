import {
  Column,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { AccountEntity } from "./account.entity";
import { ActivityEntity } from "./activity.entity";
import { ApikeyEntity } from "./apikey.entity";
import { AssetEntity } from "./asset.entity";
import { CommentEntity } from "./comment.entity";
import { InvitationEntity } from "./invitation.entity";
import { NotificationEntity } from "./notification.entity";
import { SessionEntity } from "./session.entity";
import { TaskEntity } from "./task.entity";
import { TeamMemberEntity } from "./team-member.entity";
import { TimeEntryEntity } from "./time-entry.entity";
import { UserNotificationPreferenceEntity } from "./user-notification-preference.entity";
import { UserNotificationWorkspaceRuleEntity } from "./user-notification-workspace-rule.entity";
import { WorkspaceUserEntity } from "./workspace-user.entity";

// Unique: user_email_unique (email)
@Entity({ name: "user" })
export class UserEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "name", type: "text" })
  name: string;

  @Column({ name: "email", type: "text" })
  email: string;

  @Column({ name: "email_verified", type: "boolean", default: false })
  emailVerified: boolean; // app default: false

  @Column({ name: "image", type: "text", nullable: true })
  image: string | null;

  @Column({ name: "locale", type: "text", nullable: true })
  locale: string | null;

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

  @Column({
    name: "is_anonymous",
    type: "boolean",
    nullable: true,
    default: false,
  })
  isAnonymous: boolean | null;

  @Column({ name: "role", type: "text", nullable: true })
  role: string | null;

  @Column({ name: "banned", type: "boolean", nullable: true, default: false })
  banned: boolean | null;

  @Column({ name: "ban_reason", type: "text", nullable: true })
  banReason: string | null;

  @Column({ name: "ban_expires", type: "timestamp", nullable: true })
  banExpires: Date | null;

  @OneToMany(() => SessionEntity, (session) => session.user)
  sessions?: Relation<SessionEntity[]>;

  @OneToMany(() => AccountEntity, (account) => account.user)
  accounts?: Relation<AccountEntity[]>;

  @OneToMany(() => TeamMemberEntity, (teamMember) => teamMember.user)
  teamMembers?: Relation<TeamMemberEntity[]>;

  @OneToMany(() => WorkspaceUserEntity, (workspaceUser) => workspaceUser.user)
  workspaceMemberships?: Relation<WorkspaceUserEntity[]>;

  @OneToMany(() => TaskEntity, (task) => task.assignee)
  assignedTasks?: Relation<TaskEntity[]>;

  @OneToMany(() => TimeEntryEntity, (timeEntry) => timeEntry.user)
  timeEntries?: Relation<TimeEntryEntity[]>;

  @OneToMany(() => ActivityEntity, (activity) => activity.user)
  activities?: Relation<ActivityEntity[]>;

  @OneToMany(() => CommentEntity, (comment) => comment.user)
  comments?: Relation<CommentEntity[]>;

  @OneToMany(() => AssetEntity, (asset) => asset.creator)
  assets?: Relation<AssetEntity[]>;

  @OneToMany(() => NotificationEntity, (notification) => notification.user)
  notifications?: Relation<NotificationEntity[]>;

  @OneToOne(
    () => UserNotificationPreferenceEntity,
    (userNotificationPreference) => userNotificationPreference.user,
  )
  notificationPreference?: Relation<UserNotificationPreferenceEntity> | null;

  @OneToMany(
    () => UserNotificationWorkspaceRuleEntity,
    (userNotificationWorkspaceRule) => userNotificationWorkspaceRule.user,
  )
  notificationWorkspaceRules?: Relation<UserNotificationWorkspaceRuleEntity[]>;

  @OneToMany(() => InvitationEntity, (invitation) => invitation.inviter)
  sentInvitations?: Relation<InvitationEntity[]>;

  @OneToMany(() => ApikeyEntity, (apikey) => apikey.user)
  apikeys?: Relation<ApikeyEntity[]>;
}
