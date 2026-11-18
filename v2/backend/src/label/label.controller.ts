import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { reply } from "../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  attachLabelToTaskRoute,
  createLabelRoute,
  deleteLabelRoute,
  detachLabelFromTaskRoute,
  getLabelRoute,
  getTaskLabelsRoute,
  getWorkspaceLabelsRoute,
  updateLabelRoute,
} from "./label.routes";
import { LabelAssignmentService } from "./label-assignment.service";
import { LabelCreationService } from "./label-creation.service";
import { LabelDeletionService } from "./label-deletion.service";
import { LabelQueryService } from "./label-query.service";
import { LabelUpdateService } from "./label-update.service";

// Declared in the previous router's order: the static `task/:taskId` and
// `workspace/:workspaceId` paths must be registered before `:id`.
@Controller("label")
export class LabelController {
  constructor(
    private readonly query: LabelQueryService,
    private readonly creation: LabelCreationService,
    private readonly assignment: LabelAssignmentService,
    private readonly update: LabelUpdateService,
    private readonly deletion: LabelDeletionService,
  ) {}

  @ApiRoute(getTaskLabelsRoute)
  @Access(workspaceAccess.fromTaskId())
  getTaskLabels(@Input() input: RouteInput<typeof getTaskLabelsRoute>) {
    return this.query.getLabelsByTaskId(input.param.taskId);
  }

  @ApiRoute(getWorkspaceLabelsRoute)
  @Access(workspaceAccess.fromParam())
  getWorkspaceLabels(
    @Input() input: RouteInput<typeof getWorkspaceLabelsRoute>,
    @UserId() userId: string,
  ) {
    return this.query.getLabelsByWorkspaceId(input.param.workspaceId, userId);
  }

  @ApiRoute(createLabelRoute)
  @Access(
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ label: ["create"] }),
  )
  createLabel(
    @Input() input: RouteInput<typeof createLabelRoute>,
    @UserId() userId: string,
  ) {
    const { name, color, workspaceId, taskId } = input.json;
    return this.creation.createLabel(name, color, taskId, workspaceId, userId);
  }

  @ApiRoute(getLabelRoute)
  @Access(workspaceAccess.fromLabel())
  getLabel(@Input() input: RouteInput<typeof getLabelRoute>) {
    return this.query.getLabel(input.param.id);
  }

  @ApiRoute(attachLabelToTaskRoute)
  @Access(
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["update"] }),
  )
  attachLabelToTask(
    @Input() input: RouteInput<typeof attachLabelToTaskRoute>,
    @UserId() userId: string,
  ) {
    return this.assignment.assignLabelToTask(
      input.param.id,
      input.json.taskId,
      userId,
    );
  }

  @ApiRoute(detachLabelFromTaskRoute)
  @Access(
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["update"] }),
  )
  detachLabelFromTask(
    @Input() input: RouteInput<typeof detachLabelFromTaskRoute>,
    @UserId() userId: string,
  ) {
    return this.assignment.unassignLabelFromTask(input.param.id, userId);
  }

  @ApiRoute(updateLabelRoute)
  @Access(
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["update"] }),
  )
  updateLabel(@Input() input: RouteInput<typeof updateLabelRoute>) {
    const { name, color } = input.json;
    return this.update.updateLabel(input.param.id, name, color);
  }

  @ApiRoute(deleteLabelRoute)
  @Access(
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["delete"] }),
  )
  async deleteLabel(
    @Input() input: RouteInput<typeof deleteLabelRoute>,
    @UserId() userId: string,
  ) {
    const result = await this.deletion.deleteLabel(input.param.id, userId);
    if (result.pendingDeletion)
      return reply(202, { ...result, pendingDeletion: true as const });
    return result;
  }
}
