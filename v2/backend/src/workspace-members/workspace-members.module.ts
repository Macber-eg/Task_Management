import { Module } from "@nestjs/common";
import { WorkspaceMemberLifecycleService } from "./workspace-member-lifecycle.service";

// `WorkspaceSeatSync` comes from the global billing module.
@Module({
  providers: [WorkspaceMemberLifecycleService],
  exports: [WorkspaceMemberLifecycleService],
})
export class WorkspaceMembersModule {}
