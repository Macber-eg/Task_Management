import { Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { StorageModule } from "../storage/storage.module";
import { BulkTaskEntitlementHandler } from "./access/bulk-task-entitlement.handler";
import { BulkTaskPermissionHandler } from "./access/bulk-task-permission.handler";
import { TaskAssigneePermissionHandler } from "./access/task-assignee-permission.handler";
import { TaskEntitlementHandler } from "./access/task-entitlement.handler";
import { PublicProjectDescriptionController } from "./controllers/public-project-description.controller";
import { TaskFieldController } from "./controllers/task-field.controller";
import { TaskMutationController } from "./controllers/task-mutation.controller";
import { TaskQueryController } from "./controllers/task-query.controller";
import { TaskMutationEffects } from "./effects/task-mutation-effects.service";
import { BulkDeleteOperation } from "./mutations/bulk/bulk-delete.operation";
import { BulkFieldOperations } from "./mutations/bulk/bulk-field.operations";
import { BulkLabelOperations } from "./mutations/bulk/bulk-label.operations";
import { BulkStatusOperation } from "./mutations/bulk/bulk-status.operation";
import { BulkUpdateService } from "./mutations/bulk/bulk-update.service";
import { TaskDuplicationService } from "./mutations/duplicate/task-duplication.service";
import { EstimateAllocationsService } from "./mutations/estimate-allocations.service";
import { TaskAssigneeService } from "./mutations/fields/task-assignee.service";
import { TaskDueDateService } from "./mutations/fields/task-due-date.service";
import { TaskPlanningService } from "./mutations/fields/task-planning.service";
import { TaskSimpleFieldService } from "./mutations/fields/task-simple-field.service";
import { TaskStatusService } from "./mutations/fields/task-status.service";
import { TaskTitleService } from "./mutations/fields/task-title.service";
import { TaskCreationService } from "./mutations/task-creation.service";
import { TaskDeletionService } from "./mutations/task-deletion.service";
import { TaskImportService } from "./mutations/task-import.service";
import { TaskMoveService } from "./mutations/task-move.service";
import { TaskReorderService } from "./mutations/task-reorder.service";
import { TaskUpdateService } from "./mutations/task-update.service";
import { AssignedTasksService } from "./queries/assigned-tasks.service";
import { BoardQueryService } from "./queries/board/board-query.service";
import { DescriptionPageService } from "./queries/description-page.service";
import { ProjectSubtasksService } from "./queries/project-subtasks.service";
import { TaskByTicketIdService } from "./queries/task-by-ticket-id.service";
import { TaskDetailService } from "./queries/task-detail.service";
import { TaskExportService } from "./queries/task-export.service";
import { TaskAssetStorage } from "./seams/task-asset-storage";
import { ObjectStoreTaskAssetStorage } from "./seams/object-store-task-asset-storage";

@Module({
  imports: [StorageModule, NotificationModule],
  // Query routes first: `GET assigned` must precede `GET :id`.
  controllers: [
    TaskQueryController,
    TaskMutationController,
    TaskFieldController,
    PublicProjectDescriptionController,
  ],
  providers: [
    TaskEntitlementHandler,
    BulkTaskPermissionHandler,
    BulkTaskEntitlementHandler,
    TaskAssigneePermissionHandler,
    TaskMutationEffects,
    AssignedTasksService,
    BoardQueryService,
    DescriptionPageService,
    ProjectSubtasksService,
    TaskByTicketIdService,
    TaskDetailService,
    TaskExportService,
    EstimateAllocationsService,
    TaskCreationService,
    TaskDuplicationService,
    TaskUpdateService,
    TaskMoveService,
    TaskReorderService,
    TaskDeletionService,
    TaskImportService,
    TaskStatusService,
    TaskSimpleFieldService,
    TaskTitleService,
    TaskDueDateService,
    TaskAssigneeService,
    TaskPlanningService,
    BulkUpdateService,
    BulkStatusOperation,
    BulkFieldOperations,
    BulkDeleteOperation,
    BulkLabelOperations,
    { provide: TaskAssetStorage, useClass: ObjectStoreTaskAssetStorage },
  ],
  exports: [
    BoardQueryService,
    DescriptionPageService,
    TaskDetailService,
    TaskMutationEffects,
  ],
})
export class TaskModule {}
