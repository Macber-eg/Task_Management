import { Controller, Req } from "@nestjs/common";
import { Access } from "../../access/access-rule";
import { requireWorkspacePermission } from "../../access/require-workspace-permission";
import { workspaceAccess } from "../../access/workspace-access";
import { WorkspacePermissionService } from "../../access/workspace-permission.service";
import { UserId } from "../../auth/current-user.decorator";
import type { ApiRequest } from "../../auth/principal";
import { HTTPException } from "../../common/errors/http-exception";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { requireBulkTaskEntitlement } from "../access/bulk-task-entitlement.handler";
import { requireBulkTaskPermission } from "../access/bulk-task-permission.handler";
import { requireTaskAssigneePermission } from "../access/task-assignee-permission.handler";
import { requireEntitlement } from "../access/task-entitlement.handler";
import { BulkUpdateService } from "../mutations/bulk/bulk-update.service";
import { TaskDuplicationService } from "../mutations/duplicate/task-duplication.service";
import { TaskCreationService } from "../mutations/task-creation.service";
import { TaskDeletionService } from "../mutations/task-deletion.service";
import { TaskImportService } from "../mutations/task-import.service";
import { TaskMoveService } from "../mutations/task-move.service";
import { TaskReorderService } from "../mutations/task-reorder.service";
import { TaskUpdateService } from "../mutations/task-update.service";
import {
  bulkUpdateTasksRoute,
  createTaskRoute,
  deleteTaskRoute,
  duplicateTaskRoute,
  importTasksRoute,
  moveTaskRoute,
  reorderTasksRoute,
  updateTaskRoute,
} from "../routes/task-mutation.routes";
import { parseTaskDates } from "../shared/validate-dates";

// `reorder` is declared before the `:projectId` create route that would
// otherwise claim it.
@Controller("task")
export class TaskMutationController {
  constructor(
    private readonly bulk: BulkUpdateService,
    private readonly reorder: TaskReorderService,
    private readonly creation: TaskCreationService,
    private readonly duplication: TaskDuplicationService,
    private readonly moves: TaskMoveService,
    private readonly updates: TaskUpdateService,
    private readonly imports: TaskImportService,
    private readonly deletion: TaskDeletionService,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  @ApiRoute(bulkUpdateTasksRoute)
  @Access(
    workspaceAccess.fromTasks(),
    requireBulkTaskPermission,
    requireBulkTaskEntitlement,
  )
  bulkUpdateTasks(
    @Input() input: RouteInput<typeof bulkUpdateTasksRoute>,
    @UserId() userId: string,
  ) {
    const { taskIds, operation, value } = input.json;

    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    if (
      operation !== "delete" &&
      operation !== "updateDueDate" &&
      value === undefined
    ) {
      throw new HTTPException(400, {
        message: "Value is required for this operation",
      });
    }

    return this.bulk.bulkUpdateTasks({ taskIds, operation, value, userId });
  }

  @ApiRoute(reorderTasksRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  )
  reorderTasks(
    @Input() input: RouteInput<typeof reorderTasksRoute>,
    @UserId() userId: string,
  ) {
    const { projectId, tasks, expectedTasks } = input.json;
    return this.reorder.reorderTasks(projectId, tasks, userId, expectedTasks);
  }

  @ApiRoute(createTaskRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  )
  createTask(
    @Input() input: RouteInput<typeof createTaskRoute>,
    @UserId() currentUserId: string,
  ) {
    const { startDate, dueDate, ...body } = input.json;
    return this.creation.createTask({
      ...body,
      ...parseTaskDates(startDate, dueDate),
      projectId: input.param.projectId,
      currentUserId,
    });
  }

  @ApiRoute(duplicateTaskRoute)
  @Access(
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  )
  async duplicateTask(
    @Input() input: RouteInput<typeof duplicateTaskRoute>,
    @UserId() currentUserId: string,
    @Req() request: ApiRequest,
  ) {
    return this.duplication.duplicateTask({
      taskId: input.param.id,
      title: input.json.title,
      currentUserId,
      canUpdateTasks: await this.permissions.hasWorkspacePermission(request, {
        task: ["update"],
      }),
    });
  }

  @ApiRoute(moveTaskRoute)
  @Access(
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  )
  moveTask(
    @Input() input: RouteInput<typeof moveTaskRoute>,
    @UserId() currentUserId: string,
  ) {
    const { destinationProjectId, destinationStatus } = input.json;
    return this.moves.moveTask({
      taskId: input.param.id,
      destinationProjectId,
      destinationStatus,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskRoute)
  @Access(
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireTaskAssigneePermission,
    requireEntitlement,
  )
  updateTask(
    @Input() input: RouteInput<typeof updateTaskRoute>,
    @UserId() currentUserId: string,
  ) {
    const { startDate, dueDate, ...body } = input.json;
    return this.updates.updateTask({
      ...body,
      ...parseTaskDates(startDate, dueDate),
      id: input.param.id,
      currentUserId,
    });
  }

  @ApiRoute(importTasksRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  )
  importTasks(
    @Input() input: RouteInput<typeof importTasksRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.imports.importTasks(
      input.param.projectId,
      input.json.tasks,
      currentUserId,
    );
  }

  @ApiRoute(deleteTaskRoute)
  @Access(
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["delete"] }),
  )
  deleteTask(
    @Input() input: RouteInput<typeof deleteTaskRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.deletion.deleteTask(input.param.id, currentUserId);
  }
}
