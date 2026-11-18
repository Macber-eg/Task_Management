import { Global, Module } from "@nestjs/common";
import { AccessGuard } from "./access.guard";
import { ApiKeyScopeHandler } from "./api-key-scope.handler";
import { InstanceAdminHandler } from "./instance-admin.handler";
import { ProjectAccessService } from "./project-access.service";
import { UserSessionHandler } from "./user-session.handler";
import { WorkspaceAccessHandler } from "./workspace-access.handler";
import { WorkspaceMembershipService } from "./workspace-membership.service";
import { WorkspacePermissionHandler } from "./workspace-permission.handler";
import { WorkspacePermissionService } from "./workspace-permission.service";
import { WorkspaceScopeService } from "./workspace-scope.service";

const providers = [
  AccessGuard,
  ApiKeyScopeHandler,
  InstanceAdminHandler,
  ProjectAccessService,
  UserSessionHandler,
  WorkspaceAccessHandler,
  WorkspaceMembershipService,
  WorkspacePermissionHandler,
  WorkspacePermissionService,
  WorkspaceScopeService,
];

@Global()
@Module({ providers, exports: providers })
export class AccessModule {}
