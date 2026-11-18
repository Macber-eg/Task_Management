import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { RequireEntitlementHandler } from "./entitlements/require-entitlement.handler";
import { ProjectController } from "./project.controller";
import { ProjectCreationService } from "./project-creation.service";
import { ProjectDeletionService } from "./project-deletion.service";
import { ProjectMoveAuthorization } from "./project-move-authorization";
import { ProjectMoveService } from "./project-move.service";
import { ProjectQueryService } from "./project-query.service";
import { ProjectReorderService } from "./project-reorder.service";
import { ProjectUpdateService } from "./project-update.service";
import { PublicProjectController } from "./public-project.controller";
import { PublicProjectService } from "./public-project.service";

@Module({
  imports: [StorageModule],
  controllers: [ProjectController, PublicProjectController],
  providers: [
    ProjectQueryService,
    ProjectCreationService,
    ProjectReorderService,
    ProjectUpdateService,
    ProjectDeletionService,
    ProjectMoveService,
    ProjectMoveAuthorization,
    PublicProjectService,
    RequireEntitlementHandler,
  ],
})
export class ProjectModule {}
