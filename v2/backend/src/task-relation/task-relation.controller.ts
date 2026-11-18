import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { AuthorizedWorkspaceId } from "./authorized-workspace-id.decorator";
import {
  createTaskRelationRoute,
  deleteTaskRelationRoute,
  getTaskRelationsRoute,
} from "./task-relation.routes";
import { taskRelationAccess } from "./task-relation-access";
import { TaskRelationCreationService } from "./task-relation-creation.service";
import { TaskRelationDeletionService } from "./task-relation-deletion.service";
import { TaskRelationQueryService } from "./task-relation-query.service";

@Controller("task-relation")
export class TaskRelationController {
  constructor(
    private readonly query: TaskRelationQueryService,
    private readonly creation: TaskRelationCreationService,
    private readonly deletion: TaskRelationDeletionService,
  ) {}

  @ApiRoute(getTaskRelationsRoute)
  @Access(workspaceAccess.fromTaskId("taskId"))
  getTaskRelations(
    @Input() input: RouteInput<typeof getTaskRelationsRoute>,
    @AuthorizedWorkspaceId() workspaceId: string,
    @UserId() userId: string,
  ) {
    return this.query.getTaskRelations(input.param.taskId, workspaceId, userId);
  }

  @ApiRoute(createTaskRelationRoute)
  @Access(
    taskRelationAccess.fromSourceTask(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  createTaskRelation(
    @Input() input: RouteInput<typeof createTaskRelationRoute>,
    @AuthorizedWorkspaceId() workspaceId: string,
    @UserId() userId: string,
  ) {
    const { sourceTaskId, targetTaskId, relationType } = input.json;
    return this.creation.createTaskRelation({
      sourceTaskId,
      targetTaskId,
      relationType,
      userId,
      workspaceId,
    });
  }

  @ApiRoute(deleteTaskRelationRoute)
  @Access(
    taskRelationAccess.fromRelation(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  deleteTaskRelation(
    @Input() input: RouteInput<typeof deleteTaskRelationRoute>,
    @AuthorizedWorkspaceId() workspaceId: string,
    @UserId() userId: string,
  ) {
    return this.deletion.deleteTaskRelation(
      input.param.id,
      userId,
      workspaceId,
    );
  }
}
