import { Module } from "@nestjs/common";
import { ChatSharedModule } from "../shared/chat-shared.module";
import { SlackController } from "./slack.controller";
import { SlackIntegrationService } from "./slack-integration.service";
import { SlackPlugin } from "./slack.plugin";

@Module({
  imports: [ChatSharedModule],
  controllers: [SlackController],
  providers: [SlackPlugin, SlackIntegrationService],
})
export class SlackModule {}
