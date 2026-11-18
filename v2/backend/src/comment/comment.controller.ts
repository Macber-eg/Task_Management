import { Controller, Req } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { WorkspacePermissionService } from "../access/workspace-permission.service";
import { UserId } from "../auth/current-user.decorator";
import type { ApiRequest } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createTaskCommentRoute,
  deleteTaskCommentRoute,
  getTaskCommentsRoute,
  updateTaskCommentRoute,
} from "./comment.routes";
import { CommentCreationService } from "./comment-creation.service";
import { CommentDeletionService } from "./comment-deletion.service";
import { CommentQueryService } from "./comment-query.service";
import { CommentUpdateService } from "./comment-update.service";

@Controller("comment")
export class CommentController {
  constructor(
    private readonly query: CommentQueryService,
    private readonly creation: CommentCreationService,
    private readonly update: CommentUpdateService,
    private readonly deletion: CommentDeletionService,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  @ApiRoute(getTaskCommentsRoute)
  @Access(workspaceAccess.fromTaskId())
  getTaskComments(@Input() input: RouteInput<typeof getTaskCommentsRoute>) {
    return this.query.getComments(input.param.taskId);
  }

  @ApiRoute(createTaskCommentRoute)
  @Access(
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  async createTaskComment(
    @Input() input: RouteInput<typeof createTaskCommentRoute>,
    @UserId() userId: string,
    @Req() request: ApiRequest,
  ) {
    const { taskId } = input.param;
    const { content, externalUserName, externalSource } = input.json;
    if (
      externalUserName &&
      externalSource &&
      !(await this.permissions.hasWorkspacePermission(request, {
        workspace: ["manage_settings"],
      }))
    ) {
      throw new HTTPException(403, {
        message:
          "Importing external authors requires workspace:manage_settings permission",
      });
    }
    // Both or neither: a name without a source would render as an
    // unattributed impersonation of a real account.
    const external =
      externalUserName && externalSource
        ? { userName: externalUserName, source: externalSource }
        : undefined;
    return this.creation.createComment(taskId, userId, content, external);
  }

  @ApiRoute(updateTaskCommentRoute)
  @Access(
    workspaceAccess.fromComment(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  updateTaskComment(
    @Input() input: RouteInput<typeof updateTaskCommentRoute>,
    @UserId() userId: string,
  ) {
    return this.update.updateComment(
      userId,
      input.param.id,
      input.json.content,
    );
  }

  @ApiRoute(deleteTaskCommentRoute)
  @Access(
    workspaceAccess.fromComment(),
    requireWorkspacePermission({ task: ["update"] }),
  )
  deleteTaskComment(
    @Input() input: RouteInput<typeof deleteTaskCommentRoute>,
    @UserId() userId: string,
  ) {
    return this.deletion.deleteComment(userId, input.param.id);
  }
}
