import { Controller } from "@nestjs/common";
import { Access } from "../../access/access-rule";
import { requireWorkspacePermission } from "../../access/require-workspace-permission";
import { workspaceAccess } from "../../access/workspace-access";
import { UserId } from "../../auth/current-user.decorator";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { requireEntitlement } from "../access/task-entitlement.handler";
import { EstimateAllocationsService } from "../mutations/estimate-allocations.service";
import { TaskAssigneeService } from "../mutations/fields/task-assignee.service";
import { TaskDueDateService } from "../mutations/fields/task-due-date.service";
import { TaskPlanningService } from "../mutations/fields/task-planning.service";
import { TaskSimpleFieldService } from "../mutations/fields/task-simple-field.service";
import { TaskStatusService } from "../mutations/fields/task-status.service";
import { TaskTitleService } from "../mutations/fields/task-title.service";
import {
  putTaskEstimateAllocationsRoute,
  updateTaskAssigneeRoute,
  updateTaskDescriptionRoute,
  updateTaskDueDateRoute,
  updateTaskEstimateRoute,
  updateTaskPhaseRoute,
  updateTaskPriorityRoute,
  updateTaskSprintRoute,
  updateTaskStatusRoute,
  updateTaskTitleRoute,
} from "../routes/task-field.routes";
import { validateAndParseDate } from "../shared/validate-dates";

const updateTask = [
  workspaceAccess.fromTask(),
  requireWorkspacePermission({ task: ["update"] }),
  requireEntitlement,
];

/** Single-field task edits. */
@Controller("task")
export class TaskFieldController {
  constructor(
    private readonly status: TaskStatusService,
    private readonly fields: TaskSimpleFieldService,
    private readonly allocations: EstimateAllocationsService,
    private readonly assignee: TaskAssigneeService,
    private readonly planning: TaskPlanningService,
    private readonly dueDate: TaskDueDateService,
    private readonly title: TaskTitleService,
  ) {}

  @ApiRoute(updateTaskStatusRoute)
  @Access(...updateTask)
  updateTaskStatus(
    @Input() input: RouteInput<typeof updateTaskStatusRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.status.updateTaskStatus({
      id: input.param.id,
      status: input.json.status,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskPriorityRoute)
  @Access(...updateTask)
  updateTaskPriority(
    @Input() input: RouteInput<typeof updateTaskPriorityRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.fields.updateTaskPriority({
      id: input.param.id,
      priority: input.json.priority,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskEstimateRoute)
  @Access(...updateTask)
  updateTaskEstimate(
    @Input() input: RouteInput<typeof updateTaskEstimateRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.fields.updateTaskEstimate({
      id: input.param.id,
      estimatedMinutes: input.json.estimatedMinutes,
      currentUserId,
    });
  }

  @ApiRoute(putTaskEstimateAllocationsRoute)
  @Access(...updateTask)
  putTaskEstimateAllocations(
    @Input() input: RouteInput<typeof putTaskEstimateAllocationsRoute>,
  ) {
    return this.allocations.putTaskEstimateAllocations(
      input.param.id,
      input.json.allocations,
    );
  }

  @ApiRoute(updateTaskAssigneeRoute)
  @Access(
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["assign"] }),
    requireEntitlement,
  )
  updateTaskAssignee(
    @Input() input: RouteInput<typeof updateTaskAssigneeRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.assignee.updateTaskAssignee({
      id: input.param.id,
      userId: input.json.userId,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskPhaseRoute)
  @Access(...updateTask)
  updateTaskPhase(
    @Input() input: RouteInput<typeof updateTaskPhaseRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.planning.updateTaskPhase({
      id: input.param.id,
      phaseId: input.json.phaseId,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskSprintRoute)
  @Access(...updateTask)
  updateTaskSprint(
    @Input() input: RouteInput<typeof updateTaskSprintRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.planning.updateTaskSprint({
      id: input.param.id,
      sprintId: input.json.sprintId,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskDueDateRoute)
  @Access(...updateTask)
  updateTaskDueDate(
    @Input() input: RouteInput<typeof updateTaskDueDateRoute>,
    @UserId() currentUserId: string,
  ) {
    const { dueDate = null } = input.json;
    return this.dueDate.updateTaskDueDate({
      id: input.param.id,
      dueDate: dueDate ? validateAndParseDate(dueDate, "dueDate") : null,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskTitleRoute)
  @Access(...updateTask)
  updateTaskTitle(
    @Input() input: RouteInput<typeof updateTaskTitleRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.title.updateTaskTitle({
      id: input.param.id,
      title: input.json.title,
      currentUserId,
    });
  }

  @ApiRoute(updateTaskDescriptionRoute)
  @Access(...updateTask)
  updateTaskDescription(
    @Input() input: RouteInput<typeof updateTaskDescriptionRoute>,
    @UserId() currentUserId: string,
  ) {
    return this.fields.updateTaskDescription({
      id: input.param.id,
      description: input.json.description,
      currentUserId,
    });
  }
}
