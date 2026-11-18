import { Module } from "@nestjs/common";
import { ChatSharedModule } from "../shared/chat-shared.module";
import { GenericWebhookController } from "./generic-webhook.controller";
import { GenericWebhookDelivery } from "./generic-webhook-delivery";
import { GenericWebhookHealth } from "./generic-webhook-health";
import { GenericWebhookIntegrationService } from "./generic-webhook-integration.service";
import { GenericWebhookPlugin } from "./generic-webhook.plugin";
import { ProjectWebhookReminders } from "./project-webhook-reminders";

@Module({
  imports: [ChatSharedModule],
  controllers: [GenericWebhookController],
  providers: [
    GenericWebhookHealth,
    GenericWebhookDelivery,
    GenericWebhookPlugin,
    GenericWebhookIntegrationService,
    ProjectWebhookReminders,
  ],
  exports: [GenericWebhookDelivery, ProjectWebhookReminders],
})
export class GenericWebhookModule {}
