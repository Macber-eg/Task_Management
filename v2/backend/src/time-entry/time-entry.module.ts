import { Module } from "@nestjs/common";
import { TimeEntryController } from "./time-entry.controller";
import { TimeEntryCreationService } from "./time-entry-creation.service";
import { TimeEntryDeletionService } from "./time-entry-deletion.service";
import { TimeEntryQueryService } from "./time-entry-query.service";
import { TimeEntryUpdateService } from "./time-entry-update.service";

@Module({
  controllers: [TimeEntryController],
  providers: [
    TimeEntryQueryService,
    TimeEntryCreationService,
    TimeEntryUpdateService,
    TimeEntryDeletionService,
  ],
})
export class TimeEntryModule {}
