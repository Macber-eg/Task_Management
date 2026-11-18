import { Controller } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { CommentCreationService } from "../comment/comment-creation.service";
import { CommentDeletionService } from "../comment/comment-deletion.service";
import { CommentUpdateService } from "../comment/comment-update.service";
import { HTTPException } from "../common/errors/http-exception";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createActivityRoute,
  createCommentRoute,
  deleteCommentRoute,
  getActivitiesRoute,
  getWorkspaceActivitiesRoute,
  updateCommentRoute,
} from "./activity.routes";
import { ActivityQueryService } from "./activity-query.service";
import { createActivity } from "./create-activity";
import { WorkspaceActivityService } from "./workspace-activity.service";

// Declared in the previous router's order: `workspace/:workspaceId` must be
// registered before `:taskId`.
@Controller("activity")
export class ActivityController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly query: ActivityQueryService,
    private readonly workspaceActivity: WorkspaceActivityService,
    private readonly commentCreation: CommentCreationService,
    private readonly commentUpdate: CommentUpdateService,
    private readonly commentDeletion: CommentDeletionService,
  ) {}

  @ApiRoute(getWorkspaceActivitiesRoute)
  @Access(
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ project: ["read"], task: ["read"] }),
  )
  getWorkspaceActivities(
    @Input() input: RouteInput<typeof getWorkspaceActivitiesRoute>,
    @UserId() userId: string,
  ) {
    return this.workspaceActivity.getWorkspaceActivities(
      input.param.workspaceId,
      userId,
    );
  }

  @ApiRoute(getActivitiesRoute)
  @Access(workspaceAccess.fromTaskId())
  getActivities(
    @Input() input: RouteInput<typeof getActivitiesRoute>,
    @UserId() userId: string,
  ) {
    return this.query.getActivities(
      input.param.taskId,
      userId,
      input.query.limit,
    );
  }

  @ApiRoute(createActivityRoute)
  @Access(
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  createActivity(
    @Input() input: RouteInput<typeof createActivityRoute>,
    @UserId() userId: string,
  ) {
    const { taskId, message, type, eventData } = input.json;
    if (type === "comment") {
      throw new HTTPException(400, {
        message: "Use the comment endpoint to create comments",
      });
    }
    return createActivity(
      this.dataSource.manager,
      taskId,
      type,
      userId,
      message,
      eventData,
    );
  }

  @ApiRoute(createCommentRoute)
  @Access(
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  createComment(
    @Input() input: RouteInput<typeof createCommentRoute>,
    @UserId() userId: string,
  ) {
    const { taskId, comment } = input.json;
    return this.commentCreation.createComment(taskId, userId, comment);
  }

  @ApiRoute(updateCommentRoute)
  @Access(workspaceAccess.fromActivity("activityId"))
  updateComment(
    @Input() input: RouteInput<typeof updateCommentRoute>,
    @UserId() userId: string,
  ) {
    const { activityId, comment } = input.json;
    return this.commentUpdate.updateComment(userId, activityId, comment);
  }

  @ApiRoute(deleteCommentRoute)
  @Access(workspaceAccess.fromActivity("activityId"))
  deleteComment(
    @Input() input: RouteInput<typeof deleteCommentRoute>,
    @UserId() userId: string,
  ) {
    return this.commentDeletion.deleteComment(userId, input.json.activityId);
  }
}
