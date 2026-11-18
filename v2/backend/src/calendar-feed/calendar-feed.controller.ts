import { Controller, Req } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { WorkspacePermissionService } from "../access/workspace-permission.service";
import type { ApiRequest } from "../auth/principal";
import { reply } from "../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { ResolvedWorkspaceId } from "../project/resolved-workspace-id.decorator";
import {
  createCalendarFeedRoute,
  listCalendarFeedsRoute,
  revokeCalendarFeedRoute,
} from "./calendar-feed.routes";
import { CalendarFeedService } from "./calendar-feed.service";

const NO_STORE = { "Cache-Control": "private, no-store" };

// Feed tokens are secrets: managing them requires project sharing permission.
const sharing = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ project: ["share"] }),
];

@Controller("calendar-feed")
export class CalendarFeedController {
  constructor(
    private readonly feeds: CalendarFeedService,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  @ApiRoute(listCalendarFeedsRoute)
  @Access(...sharing)
  async listCalendarFeeds(
    @Input() input: RouteInput<typeof listCalendarFeedsRoute>,
  ) {
    return reply(
      200,
      await this.feeds.listCalendarFeeds(input.param.projectId),
      NO_STORE,
    );
  }

  @ApiRoute(createCalendarFeedRoute)
  @Access(...sharing)
  async createCalendarFeed(
    @Input() input: RouteInput<typeof createCalendarFeedRoute>,
    @Req() request: ApiRequest,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    const { labelIds, timeZone } = input.json;
    const feed = await this.feeds.createCalendarFeed(
      input.param.projectId,
      workspaceId,
      labelIds,
      timeZone,
      await this.permissions.hasWorkspacePermission(request, {
        label: ["create"],
      }),
    );
    return reply(201, feed, NO_STORE);
  }

  @ApiRoute(revokeCalendarFeedRoute)
  @Access(...sharing)
  revokeCalendarFeed(
    @Input() input: RouteInput<typeof revokeCalendarFeedRoute>,
  ) {
    return this.feeds.revokeCalendarFeed(input.param.projectId, input.param.id);
  }
}
