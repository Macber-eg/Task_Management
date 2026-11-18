import { Module } from "@nestjs/common";
import { ChatSharedModule } from "../shared/chat-shared.module";
import { DiscordController } from "./discord.controller";
import { DiscordIntegrationService } from "./discord-integration.service";
import { DiscordPlugin } from "./discord.plugin";

@Module({
  imports: [ChatSharedModule],
  controllers: [DiscordController],
  providers: [DiscordPlugin, DiscordIntegrationService],
})
export class DiscordModule {}
