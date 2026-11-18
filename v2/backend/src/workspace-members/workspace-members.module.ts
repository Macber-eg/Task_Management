import { Module } from "@nestjs/common";
import { NoopWorkspaceSeatSync } from "./noop-workspace-seat-sync";
import { WorkspaceMemberLifecycleService } from "./workspace-member-lifecycle.service";
import { WorkspaceSeatSync } from "./workspace-seat-sync";

@Module({
  providers: [
    WorkspaceMemberLifecycleService,
    { provide: WorkspaceSeatSync, useClass: NoopWorkspaceSeatSync },
  ],
  exports: [WorkspaceMemberLifecycleService],
})
export class WorkspaceMembersModule {}
