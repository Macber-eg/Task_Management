import { AccountEntity } from "./account.entity";
import { ActivityEntity } from "./activity.entity";
import { ApikeyEntity } from "./apikey.entity";
import { AssetEntity } from "./asset.entity";
import { BillingEventEntity } from "./billing-event.entity";
import { BillingReminderSentEntity } from "./billing-reminder-sent.entity";
import { CalendarFeedEntity } from "./calendar-feed.entity";
import { ColumnEntity } from "./column.entity";
import { CommentEntity } from "./comment.entity";
import { CustomFieldDefinitionEntity } from "./custom-field-definition.entity";
import { CustomFieldValueEntity } from "./custom-field-value.entity";
import { DataMigrationEntity } from "./data-migration.entity";
import { DeviceCodeEntity } from "./device-code.entity";
import { ExternalLinkEntity } from "./external-link.entity";
import { GithubImportEntity } from "./github-import.entity";
import { ImportRunEntity } from "./import-run.entity";
import { IntegrationEntity } from "./integration.entity";
import { InvitationEntity } from "./invitation.entity";
import { JobLeaseEntity } from "./job-lease.entity";
import { LabelEntity } from "./label.entity";
import { McpOauthStateEntity } from "./mcp-oauth-state.entity";
import { NotificationEntity } from "./notification.entity";
import { ProjectBookmarkEntity } from "./project-bookmark.entity";
import { ProjectPhaseEntity } from "./project-phase.entity";
import { ProjectRecentAccessEntity } from "./project-recent-access.entity";
import { ProjectSprintEntity } from "./project-sprint.entity";
import { ProjectEntity } from "./project.entity";
import { SessionEntity } from "./session.entity";
import { StorageCleanupEntity } from "./storage-cleanup.entity";
import { TaskEstimateAllocationEntity } from "./task-estimate-allocation.entity";
import { TaskRelationEntity } from "./task-relation.entity";
import { TaskReminderSentEntity } from "./task-reminder-sent.entity";
import { TaskEntity } from "./task.entity";
import { TeamMemberEntity } from "./team-member.entity";
import { TeamEntity } from "./team.entity";
import { TimeEntryAuditEntity } from "./time-entry-audit.entity";
import { TimeEntryEntity } from "./time-entry.entity";
import { TrialGrantEntity } from "./trial-grant.entity";
import { UserAvatarEntity } from "./user-avatar.entity";
import { UserNotificationPreferenceEntity } from "./user-notification-preference.entity";
import { UserNotificationWorkspaceProjectEntity } from "./user-notification-workspace-project.entity";
import { UserNotificationWorkspaceRuleEntity } from "./user-notification-workspace-rule.entity";
import { UserEntity } from "./user.entity";
import { VerificationEntity } from "./verification.entity";
import { WorkflowRuleEntity } from "./workflow-rule.entity";
import { WorkspaceBillingEntity } from "./workspace-billing.entity";
import { WorkspaceMemberAccessEntity } from "./workspace-member-access.entity";
import { WorkspaceMemberCapacityEntity } from "./workspace-member-capacity.entity";
import { WorkspaceMemberProjectEntity } from "./workspace-member-project.entity";
import { WorkspaceRoleEntity } from "./workspace-role.entity";
import { WorkspaceUserEntity } from "./workspace-user.entity";
import { WorkspaceEntity } from "./workspace.entity";

export {
  AccountEntity,
  ActivityEntity,
  ApikeyEntity,
  AssetEntity,
  BillingEventEntity,
  BillingReminderSentEntity,
  CalendarFeedEntity,
  ColumnEntity,
  CommentEntity,
  CustomFieldDefinitionEntity,
  CustomFieldValueEntity,
  DataMigrationEntity,
  DeviceCodeEntity,
  ExternalLinkEntity,
  GithubImportEntity,
  ImportRunEntity,
  IntegrationEntity,
  InvitationEntity,
  JobLeaseEntity,
  LabelEntity,
  McpOauthStateEntity,
  NotificationEntity,
  ProjectBookmarkEntity,
  ProjectPhaseEntity,
  ProjectRecentAccessEntity,
  ProjectSprintEntity,
  ProjectEntity,
  SessionEntity,
  StorageCleanupEntity,
  TaskEstimateAllocationEntity,
  TaskRelationEntity,
  TaskReminderSentEntity,
  TaskEntity,
  TeamMemberEntity,
  TeamEntity,
  TimeEntryAuditEntity,
  TimeEntryEntity,
  TrialGrantEntity,
  UserAvatarEntity,
  UserNotificationPreferenceEntity,
  UserNotificationWorkspaceProjectEntity,
  UserNotificationWorkspaceRuleEntity,
  UserEntity,
  VerificationEntity,
  WorkflowRuleEntity,
  WorkspaceBillingEntity,
  WorkspaceMemberAccessEntity,
  WorkspaceMemberCapacityEntity,
  WorkspaceMemberProjectEntity,
  WorkspaceRoleEntity,
  WorkspaceUserEntity,
  WorkspaceEntity,
};

export const ALL_ENTITIES = [
  AccountEntity,
  ActivityEntity,
  ApikeyEntity,
  AssetEntity,
  BillingEventEntity,
  BillingReminderSentEntity,
  CalendarFeedEntity,
  ColumnEntity,
  CommentEntity,
  CustomFieldDefinitionEntity,
  CustomFieldValueEntity,
  DataMigrationEntity,
  DeviceCodeEntity,
  ExternalLinkEntity,
  GithubImportEntity,
  ImportRunEntity,
  IntegrationEntity,
  InvitationEntity,
  JobLeaseEntity,
  LabelEntity,
  McpOauthStateEntity,
  NotificationEntity,
  ProjectBookmarkEntity,
  ProjectPhaseEntity,
  ProjectRecentAccessEntity,
  ProjectSprintEntity,
  ProjectEntity,
  SessionEntity,
  StorageCleanupEntity,
  TaskEstimateAllocationEntity,
  TaskRelationEntity,
  TaskReminderSentEntity,
  TaskEntity,
  TeamMemberEntity,
  TeamEntity,
  TimeEntryAuditEntity,
  TimeEntryEntity,
  TrialGrantEntity,
  UserAvatarEntity,
  UserNotificationPreferenceEntity,
  UserNotificationWorkspaceProjectEntity,
  UserNotificationWorkspaceRuleEntity,
  UserEntity,
  VerificationEntity,
  WorkflowRuleEntity,
  WorkspaceBillingEntity,
  WorkspaceMemberAccessEntity,
  WorkspaceMemberCapacityEntity,
  WorkspaceMemberProjectEntity,
  WorkspaceRoleEntity,
  WorkspaceUserEntity,
  WorkspaceEntity,
] as const;
