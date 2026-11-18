import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Controller, StreamableFile } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { reply } from "../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { CalendarFeedReaderService } from "./calendar-feed-reader.service";
import { getCalendarFeedRoute } from "./calendar-feed.routes";

const CALENDAR_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "text/calendar; charset=utf-8",
  "Content-Disposition": 'inline; filename="kaneo.ics"',
};

/** The subscription link calendar apps poll; the token is the credential. */
@Controller("calendar-feed")
export class PublicCalendarFeedController {
  constructor(private readonly reader: CalendarFeedReaderService) {}

  @Public()
  @ApiRoute(getCalendarFeedRoute)
  async getCalendarFeed(
    @Input() input: RouteInput<typeof getCalendarFeedRoute>,
  ) {
    const calendar = await this.reader.getCalendarFeed(input.param.token);
    return reply(
      200,
      new StreamableFile(
        Readable.fromWeb(calendar as NodeReadableStream<Uint8Array>),
      ),
      CALENDAR_HEADERS,
    );
  }
}
