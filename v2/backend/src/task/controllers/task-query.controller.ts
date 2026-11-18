import { Controller } from "@nestjs/common";
import { Access } from "../../access/access-rule";
import { requireWorkspacePermission } from "../../access/require-workspace-permission";
import { workspaceAccess } from "../../access/workspace-access";
import { UserId } from "../../auth/current-user.decorator";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { EstimateAllocationsService } from "../mutations/estimate-allocations.service";
import { AssignedTasksService } from "../queries/assigned-tasks.service";
import { BoardQueryService } from "../queries/board/board-query.service";
import { DescriptionPageService } from "../queries/description-page.service";
import { ProjectSubtasksService } from "../queries/project-subtasks.service";
import { TaskByTicketIdService } from "../queries/task-by-ticket-id.service";
import { TaskDetailService } from "../queries/task-detail.service";
import { TaskExportService } from "../queries/task-export.service";
import {
  descriptionMatchesRoute,
  descriptionPageRoute,
  exportTasksRoute,
  getTaskByTicketIdRoute,
  getTaskEstimateAllocationsRoute,
  getTaskRoute,
  listAssignedTasksRoute,
  listProjectSubtasksRoute,
  listTasksRoute,
} from "../routes/task-query.routes";

// Declared in the previous router's order: `assigned` must be registered
// before `:id`, which would otherwise claim it.
@Controller("task")
export class TaskQueryController {
  constructor(
    private readonly descriptions: DescriptionPageService,
    private readonly assigned: AssignedTasksService,
    private readonly subtasks: ProjectSubtasksService,
    private readonly board: BoardQueryService,
    private readonly byTicketId: TaskByTicketIdService,
    private readonly detail: TaskDetailService,
    private readonly exports: TaskExportService,
    private readonly allocations: EstimateAllocationsService,
  ) {}

  @ApiRoute(descriptionPageRoute)
  @Access(workspaceAccess.fromTaskId("id"))
  getDescriptionPage(@Input() input: RouteInput<typeof descriptionPageRoute>) {
    return this.descriptions.getDescriptionPage(input.param.id, input.query);
  }

  @ApiRoute(descriptionMatchesRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  findDeferredDescriptions(
    @Input() input: RouteInput<typeof descriptionMatchesRoute>,
  ) {
    const { query, after } = input.query;
    return this.descriptions.getDeferredDescriptionMatches(
      input.param.projectId,
      query,
      after,
    );
  }

  @ApiRoute(listAssignedTasksRoute)
  @Access(
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ project: ["read"], task: ["read"] }),
  )
  listAssignedTasks(
    @Input() input: RouteInput<typeof listAssignedTasksRoute>,
    @UserId() userId: string,
  ) {
    const { workspaceId, countOnly } = input.query;
    return this.assigned.getAssignedTasks(
      workspaceId,
      userId,
      countOnly === "true",
    );
  }

  @ApiRoute(listProjectSubtasksRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  listProjectSubtasks(
    @Input() input: RouteInput<typeof listProjectSubtasksRoute>,
  ) {
    return this.subtasks.getProjectSubtasks(input.param.projectId);
  }

  @ApiRoute(listTasksRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  listTasks(
    @Input() input: RouteInput<typeof listTasksRoute>,
    @UserId() userId: string,
  ) {
    return this.board.getTasks(input.param.projectId, input.query, userId);
  }

  @ApiRoute(getTaskByTicketIdRoute)
  getTaskByTicketId(
    @Input() input: RouteInput<typeof getTaskByTicketIdRoute>,
    @UserId() userId: string,
  ) {
    return this.byTicketId.getTaskByTicketId(
      input.param.ticketId,
      userId,
      input.query,
    );
  }

  @ApiRoute(getTaskRoute)
  @Access(workspaceAccess.fromTask())
  getTask(
    @Input() input: RouteInput<typeof getTaskRoute>,
    @UserId() userId: string,
  ) {
    return input.query.view === "board"
      ? this.detail.getBoardTask(input.param.id, userId)
      : this.detail.getTask(input.param.id);
  }

  @ApiRoute(exportTasksRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  exportTasks(@Input() input: RouteInput<typeof exportTasksRoute>) {
    return this.exports.exportTasks(input.param.projectId);
  }

  @ApiRoute(getTaskEstimateAllocationsRoute)
  @Access(workspaceAccess.fromTask())
  getTaskEstimateAllocations(
    @Input() input: RouteInput<typeof getTaskEstimateAllocationsRoute>,
  ) {
    return this.allocations.getTaskEstimateAllocations(input.param.id);
  }
}
