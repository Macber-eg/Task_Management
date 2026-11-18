import { Module } from "@nestjs/common";
import { CalendarFeedController } from "./calendar-feed.controller";
import { CalendarFeedReaderService } from "./calendar-feed-reader.service";
import { CalendarFeedService } from "./calendar-feed.service";
import { PublicCalendarFeedController } from "./public-calendar-feed.controller";

@Module({
  controllers: [PublicCalendarFeedController, CalendarFeedController],
  providers: [CalendarFeedService, CalendarFeedReaderService],
})
export class CalendarFeedModule {}
