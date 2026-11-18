import { Module } from "@nestjs/common";
import { NotificationPreferencesModule } from "../notification-preferences/notification-preferences.module";
import { NotificationController } from "./notification.controller";
import { NotificationCreationService } from "./notification-creation.service";
import { NotificationEventSubscriber } from "./notification-event-subscriber";
import { NotificationInboxService } from "./notification-inbox.service";
import { NotificationQueryService } from "./notification-query.service";

@Module({
  imports: [NotificationPreferencesModule],
  controllers: [NotificationController],
  providers: [
    NotificationQueryService,
    NotificationCreationService,
    NotificationInboxService,
    NotificationEventSubscriber,
  ],
  // Comments, task mutations and the due-date scheduler create notifications.
  exports: [NotificationCreationService],
})
export class NotificationModule {}
