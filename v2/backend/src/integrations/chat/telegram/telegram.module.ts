import { Module } from "@nestjs/common";
import { ChatSharedModule } from "../shared/chat-shared.module";
import { TelegramController } from "./telegram.controller";
import { TelegramIntegrationService } from "./telegram-integration.service";
import { TelegramPlugin } from "./telegram.plugin";

@Module({
  imports: [ChatSharedModule],
  controllers: [TelegramController],
  providers: [TelegramPlugin, TelegramIntegrationService],
})
export class TelegramModule {}
