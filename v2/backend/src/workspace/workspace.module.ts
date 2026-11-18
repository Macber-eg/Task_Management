import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../project-access/project-access.module";
import { MemberProjectAccessQueryService } from "./member-project-access-query.service";
import { MemberProjectAccessUpdateService } from "./member-project-access-update.service";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceMemberQueryService } from "./workspace-member-query.service";
import { WorkspaceQueryService } from "./workspace-query.service";

@Module({
  imports: [ProjectAccessModule],
  controllers: [WorkspaceController],
  providers: [
    WorkspaceQueryService,
    WorkspaceMemberQueryService,
    MemberProjectAccessQueryService,
    MemberProjectAccessUpdateService,
  ],
})
export class WorkspaceModule {}
