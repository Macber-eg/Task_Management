import { Module } from "@nestjs/common";
import { NotificationDeliveryService } from "./delivery/notification-delivery.service";
import { NotificationPreferencesController } from "./notification-preferences.controller";
import { NotificationPreferencesQueryService } from "./notification-preferences-query.service";
import { NotificationPreferencesUpdateService } from "./notification-preferences-update.service";
import { WorkspaceRuleService } from "./workspace-rule.service";

@Module({
  controllers: [NotificationPreferencesController],
  providers: [
    NotificationPreferencesQueryService,
    NotificationPreferencesUpdateService,
    WorkspaceRuleService,
    // `NotificationMailer` comes from the global `EmailModule`.
    NotificationDeliveryService,
  ],
  exports: [NotificationDeliveryService],
})
export class NotificationPreferencesModule {}
