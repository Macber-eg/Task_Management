import { Module } from "@nestjs/common";
import { DiscordModule } from "./discord/discord.module";
import { GenericWebhookModule } from "./generic-webhook/generic-webhook.module";
import { MattermostModule } from "./mattermost/mattermost.module";
import { SlackModule } from "./slack/slack.module";
import { TelegramModule } from "./telegram/telegram.module";

/** The outbound-only channels: chat webhooks, Telegram bots, generic webhooks. */
@Module({
  imports: [
    SlackModule,
    DiscordModule,
    MattermostModule,
    TelegramModule,
    GenericWebhookModule,
  ],
})
export class ChatIntegrationsModule {}
