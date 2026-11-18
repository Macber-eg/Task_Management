import { Module } from "@nestjs/common";
import { TaskModule } from "./task/task.module";
import { ProjectModule } from "./project/project.module";
import { ColumnModule } from "./column/column.module";
import { WorkflowRuleModule } from "./workflow-rule/workflow-rule.module";
import { ProjectHomeModule } from "./project-home/project-home.module";
import { CalendarFeedModule } from "./calendar-feed/calendar-feed.module";
import { SearchModule } from "./search/search.module";
import { CommentModule } from "./comment/comment.module";
import { ActivityModule } from "./activity/activity.module";
import { TaskRelationModule } from "./task-relation/task-relation.module";
import { ExternalLinkModule } from "./external-link/external-link.module";
import { CustomFieldModule } from "./custom-field/custom-field.module";
import { NotificationModule } from "./notification/notification.module";
import { NotificationPreferencesModule } from "./notification-preferences/notification-preferences.module";
import { TimeEntryModule } from "./time-entry/time-entry.module";
import { TimeAnalyticsModule } from "./time-analytics/time-analytics.module";
import { PlanningModule } from "./planning/planning.module";
import { AdminModule } from "./admin/admin.module";
import { EmailModule } from "./email/email.module";
import { StorageModule } from "./storage/storage.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { BillingModule } from "./billing/billing.module";
import { ImportModule } from "./import/import.module";
import { AccessModule } from "./access/access.module";
import { AuthModule } from "./auth/auth.module";
import { OAuthModule } from "./oauth/oauth.module";
import { CommonModule } from "./common/common.module";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { InstanceModule } from "./instance/instance.module";
import { InvitationModule } from "./invitation/invitation.module";
import { LabelModule } from "./label/label.module";
import { McpModule } from "./mcp/mcp.module";
import { OrganizationModule } from "./organization/organization.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { UserModule } from "./user/user.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { WorkspaceMembersModule } from "./workspace-members/workspace-members.module";
import { IntegrationsModule } from "./integrations/integrations.module";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    EventsModule,
    RealtimeModule,
    AuthModule,
    OAuthModule,
    McpModule,
    AccessModule,
    HealthModule,
    LabelModule,
    ConfigModule,
    InstanceModule,
    UserModule,
    WorkspaceModule,
    WorkspaceMembersModule,
    InvitationModule,
    OrganizationModule,
    TaskModule,
    ProjectModule,
    ColumnModule,
    WorkflowRuleModule,
    ProjectHomeModule,
    CalendarFeedModule,
    SearchModule,
    CommentModule,
    ActivityModule,
    TaskRelationModule,
    ExternalLinkModule,
    CustomFieldModule,
    NotificationModule,
    NotificationPreferencesModule,
    TimeEntryModule,
    TimeAnalyticsModule,
    PlanningModule,
    AdminModule,
    EmailModule,
    StorageModule,
    ImportModule,
    SchedulerModule,
    BillingModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
