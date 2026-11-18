import { Module } from "@nestjs/common";
import { ProjectTimeReportService } from "./project-time-report.service";
import { TimeAnalyticsController } from "./time-analytics.controller";
import { TimesheetQueryService } from "./timesheet-query.service";
import { WorkloadReportService } from "./workload-report.service";

@Module({
  controllers: [TimeAnalyticsController],
  providers: [
    ProjectTimeReportService,
    TimesheetQueryService,
    WorkloadReportService,
  ],
})
export class TimeAnalyticsModule {}
