import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createExternalLinkRoute,
  deleteExternalLinkRoute,
  getExternalLinksByTaskRoute,
} from "./external-link.routes";
import { ExternalLinkCreationService } from "./external-link-creation.service";
import { ExternalLinkDeletionService } from "./external-link-deletion.service";
import { ExternalLinkQueryService } from "./external-link-query.service";
import { parseLinkMetadata } from "./parse-link-metadata";

@Controller("external-link")
export class ExternalLinkController {
  constructor(
    private readonly query: ExternalLinkQueryService,
    private readonly creation: ExternalLinkCreationService,
    private readonly deletion: ExternalLinkDeletionService,
  ) {}

  @ApiRoute(createExternalLinkRoute)
  @Access(
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
  )
  async createExternalLink(
    @Input() input: RouteInput<typeof createExternalLinkRoute>,
    @UserId() userId: string,
  ) {
    const { url, title } = input.json;
    const link = await this.creation.createExternalLink({
      taskId: input.param.taskId,
      url,
      title,
      userId,
    });
    return { ...link, metadata: parseLinkMetadata(link.metadata) };
  }

  @ApiRoute(deleteExternalLinkRoute)
  @Access(
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
  )
  deleteExternalLink(
    @Input() input: RouteInput<typeof deleteExternalLinkRoute>,
    @UserId() userId: string,
  ) {
    const { taskId, id } = input.param;
    return this.deletion.deleteExternalLink({ taskId, id, userId });
  }

  @ApiRoute(getExternalLinksByTaskRoute)
  @Access(workspaceAccess.fromTaskId("taskId"))
  getExternalLinksByTask(
    @Input() input: RouteInput<typeof getExternalLinksByTaskRoute>,
  ) {
    return this.query.getExternalLinksByTask(input.param.taskId);
  }
}
