import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { ProjectTimeReportService } from "./project-time-report.service";
import {
  getProjectReportRoute,
  getTimesheetsRoute,
  getWorkloadRoute,
} from "./time-analytics.routes";
import { TimesheetQueryService } from "./timesheet-query.service";
import { WorkloadReportService } from "./workload-report.service";

@Controller("time-analytics")
export class TimeAnalyticsController {
  constructor(
    private readonly projectReport: ProjectTimeReportService,
    private readonly timesheets: TimesheetQueryService,
    private readonly workload: WorkloadReportService,
  ) {}

  @ApiRoute(getProjectReportRoute)
  @Access(workspaceAccess.fromProjectId())
  getProjectReport(@Input() input: RouteInput<typeof getProjectReportRoute>) {
    return this.projectReport.getProjectTimeReport(input.param.projectId, {
      phaseId: input.query.phaseId,
      sprintId: input.query.sprintId,
    });
  }

  @ApiRoute(getTimesheetsRoute)
  @Access(
    workspaceAccess.fromQuery("workspaceId"),
    requireWorkspacePermission({ project: ["read"] }),
  )
  getTimesheets(@Input() input: RouteInput<typeof getTimesheetsRoute>) {
    const query = input.query;
    return this.timesheets.loadTimesheetRows({
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      phaseId: query.phaseId,
      sprintId: query.sprintId,
      taskId: query.taskId,
      userId: query.userId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @ApiRoute(getWorkloadRoute)
  @Access(
    workspaceAccess.fromQuery("workspaceId"),
    requireWorkspacePermission({ project: ["read"] }),
  )
  getWorkload(@Input() input: RouteInput<typeof getWorkloadRoute>) {
    const query = input.query;
    return this.workload.getWorkloadReport({
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      userId: query.userId,
      from: new Date(query.from),
      to: new Date(query.to),
    });
  }
}
