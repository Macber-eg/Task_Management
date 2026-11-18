import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { GlobalSearchService } from "./global-search.service";
import { globalSearchRoute } from "./search.routes";

@Controller("search")
export class SearchController {
  constructor(private readonly search: GlobalSearchService) {}

  @ApiRoute(globalSearchRoute)
  @Access(workspaceAccess.fromQuery())
  globalSearch(
    @Input() input: RouteInput<typeof globalSearchRoute>,
    @UserId() userId: string,
  ) {
    const { q, type, workspaceId, projectId, limit, userEmail } = input.query;
    return this.search.globalSearch({
      query: q,
      userId,
      userEmail,
      type,
      workspaceId,
      projectId,
      limit,
    });
  }
}
