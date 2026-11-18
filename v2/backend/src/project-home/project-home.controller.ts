import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createProjectBookmarkRoute,
  deleteProjectBookmarkRoute,
  listProjectBookmarksRoute,
  listProjectHomeAssetsRoute,
  listProjectRecentRoute,
  recordProjectRecentRoute,
  updateProjectBookmarkRoute,
} from "./project-home.routes";
import { ProjectAssetsService } from "./project-assets.service";
import { ProjectBookmarkService } from "./project-bookmark.service";
import { ProjectRecentService } from "./project-recent.service";

// Bookmark edits by id need no workspace rule: they only touch the caller's
// own rows.
@Controller("project-home")
export class ProjectHomeController {
  constructor(
    private readonly bookmarks: ProjectBookmarkService,
    private readonly recent: ProjectRecentService,
    private readonly assets: ProjectAssetsService,
  ) {}

  @ApiRoute(listProjectBookmarksRoute)
  @Access(workspaceAccess.fromProjectId())
  listProjectBookmarks(
    @Input() input: RouteInput<typeof listProjectBookmarksRoute>,
    @UserId() userId: string,
  ) {
    return this.bookmarks.listProjectBookmarks(input.param.projectId, userId);
  }

  @ApiRoute(createProjectBookmarkRoute)
  @Access(workspaceAccess.fromProjectId())
  createProjectBookmark(
    @Input() input: RouteInput<typeof createProjectBookmarkRoute>,
    @UserId() userId: string,
  ) {
    return this.bookmarks.createProjectBookmark(
      input.param.projectId,
      userId,
      input.json.title,
      input.json.url,
    );
  }

  @ApiRoute(updateProjectBookmarkRoute)
  updateProjectBookmark(
    @Input() input: RouteInput<typeof updateProjectBookmarkRoute>,
    @UserId() userId: string,
  ) {
    return this.bookmarks.updateProjectBookmark(
      input.param.id,
      userId,
      input.json.title,
      input.json.url,
    );
  }

  @ApiRoute(deleteProjectBookmarkRoute)
  deleteProjectBookmark(
    @Input() input: RouteInput<typeof deleteProjectBookmarkRoute>,
    @UserId() userId: string,
  ) {
    return this.bookmarks.deleteProjectBookmark(input.param.id, userId);
  }

  @ApiRoute(listProjectRecentRoute)
  @Access(workspaceAccess.fromProjectId())
  listProjectRecent(
    @Input() input: RouteInput<typeof listProjectRecentRoute>,
    @UserId() userId: string,
  ) {
    return this.recent.listProjectRecent(input.param.projectId, userId);
  }

  @ApiRoute(recordProjectRecentRoute)
  @Access(workspaceAccess.fromProjectId())
  recordProjectRecent(
    @Input() input: RouteInput<typeof recordProjectRecentRoute>,
    @UserId() userId: string,
  ) {
    return this.recent.recordProjectRecent(
      input.param.projectId,
      userId,
      input.json,
    );
  }

  @ApiRoute(listProjectHomeAssetsRoute)
  @Access(workspaceAccess.fromProjectId())
  listProjectHomeAssets(
    @Input() input: RouteInput<typeof listProjectHomeAssetsRoute>,
  ) {
    return this.assets.listProjectAssets(input.param.projectId);
  }
}
