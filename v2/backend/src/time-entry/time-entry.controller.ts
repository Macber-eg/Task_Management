import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createTimeEntryRoute,
  deleteTimeEntryRoute,
  getActiveTimeEntryRoute,
  getTaskTimeEntriesRoute,
  getTimeEntryRoute,
  updateTimeEntryRoute,
} from "./time-entry.routes";
import { TimeEntryCreationService } from "./time-entry-creation.service";
import { TimeEntryDeletionService } from "./time-entry-deletion.service";
import { TimeEntryQueryService } from "./time-entry-query.service";
import { TimeEntryUpdateService } from "./time-entry-update.service";

// Declared in the previous router's order: `active` and `task/:taskId` must
// be registered before `:id`.
@Controller("time-entry")
export class TimeEntryController {
  constructor(
    private readonly query: TimeEntryQueryService,
    private readonly creation: TimeEntryCreationService,
    private readonly update: TimeEntryUpdateService,
    private readonly deletion: TimeEntryDeletionService,
  ) {}

  @ApiRoute(getActiveTimeEntryRoute)
  async getActiveTimeEntry(@UserId() userId: string) {
    return { running: await this.query.getActiveTimeEntry(userId) };
  }

  @ApiRoute(getTaskTimeEntriesRoute)
  @Access(workspaceAccess.fromTaskId())
  getTaskTimeEntries(
    @Input() input: RouteInput<typeof getTaskTimeEntriesRoute>,
  ) {
    return this.query.getTimeEntriesByTaskId(input.param.taskId);
  }

  @ApiRoute(getTimeEntryRoute)
  @Access(workspaceAccess.fromTimeEntry())
  getTimeEntry(@Input() input: RouteInput<typeof getTimeEntryRoute>) {
    return this.query.getTimeEntry(input.param.id);
  }

  @ApiRoute(createTimeEntryRoute)
  @Access(
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  createTimeEntry(
    @Input() input: RouteInput<typeof createTimeEntryRoute>,
    @UserId() userId: string,
  ) {
    const { taskId, startTime, endTime, description } = input.json;
    return this.creation.createTimeEntry({
      taskId,
      userId,
      startTime: new Date(startTime),
      endTime: endTime ? new Date(endTime) : undefined,
      description,
    });
  }

  @ApiRoute(updateTimeEntryRoute)
  @Access(
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  updateTimeEntry(
    @Input() input: RouteInput<typeof updateTimeEntryRoute>,
    @UserId() userId: string,
  ) {
    const { startTime, endTime, description } = input.json;
    return this.update.updateTimeEntry({
      timeEntryId: input.param.id,
      startTime: new Date(startTime),
      endTime: endTime ? new Date(endTime) : undefined,
      description,
      actorUserId: userId,
    });
  }

  @ApiRoute(deleteTimeEntryRoute)
  @Access(
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  deleteTimeEntry(
    @Input() input: RouteInput<typeof deleteTimeEntryRoute>,
    @UserId() userId: string,
  ) {
    return this.deletion.deleteTimeEntry(input.param.id, userId);
  }
}
