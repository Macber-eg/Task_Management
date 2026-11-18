import { Module } from "@nestjs/common";
import { ChatSharedModule } from "../shared/chat-shared.module";
import { MattermostController } from "./mattermost.controller";
import { MattermostIntegrationService } from "./mattermost-integration.service";
import { MattermostPlugin } from "./mattermost.plugin";

@Module({
  imports: [ChatSharedModule],
  controllers: [MattermostController],
  providers: [MattermostPlugin, MattermostIntegrationService],
})
export class MattermostModule {}
