import { Module } from "@nestjs/common";
import { ProjectAssetsService } from "./project-assets.service";
import { ProjectBookmarkService } from "./project-bookmark.service";
import { ProjectHomeController } from "./project-home.controller";
import { ProjectRecentService } from "./project-recent.service";

@Module({
  controllers: [ProjectHomeController],
  providers: [
    ProjectBookmarkService,
    ProjectRecentService,
    ProjectAssetsService,
  ],
})
export class ProjectHomeModule {}
