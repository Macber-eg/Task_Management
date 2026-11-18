import { Module } from "@nestjs/common";
import { AccessModule } from "./access/access.module";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { InstanceModule } from "./instance/instance.module";
import { InvitationModule } from "./invitation/invitation.module";
import { LabelModule } from "./label/label.module";
import { OrganizationModule } from "./organization/organization.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { UserModule } from "./user/user.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { WorkspaceMembersModule } from "./workspace-members/workspace-members.module";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    EventsModule,
    RealtimeModule,
    AuthModule,
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
  ],
})
export class AppModule {}
