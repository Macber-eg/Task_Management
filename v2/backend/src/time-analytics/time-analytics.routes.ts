import { createRoute, errorResponse, jsonResponse, z } from "../common/openapi";
import {
  projectIdParam,
  reportQuery,
  timesheetQuery,
  workloadQuery,
} from "./schema";

export const getProjectReportRoute = createRoute({
  method: "get",
  operationId: "getProjectTimeReport",
  path: "/project/{projectId}",
  tags: ["Time Analytics"],
  summary: "Project time analytics",
  request: {
    params: projectIdParam,
    query: reportQuery,
  },
  responses: {
    200: jsonResponse("Project time report", z.record(z.string(), z.unknown())),
    403: errorResponse("Forbidden"),
    404: errorResponse("Not found"),
  },
});

export const getTimesheetsRoute = createRoute({
  method: "get",
  operationId: "getTimesheets",
  path: "/timesheets",
  tags: ["Time Analytics"],
  summary: "Filtered timesheet rows",
  request: { query: timesheetQuery },
  responses: {
    200: jsonResponse(
      "Timesheet rows",
      z.array(z.record(z.string(), z.unknown())),
    ),
    403: errorResponse("Forbidden"),
  },
});

export const getWorkloadRoute = createRoute({
  method: "get",
  operationId: "getWorkloadReport",
  path: "/workload",
  tags: ["Time Analytics"],
  summary: "Resource workload",
  request: { query: workloadQuery },
  responses: {
    200: jsonResponse(
      "Workload rows",
      z.array(z.record(z.string(), z.unknown())),
    ),
    403: errorResponse("Forbidden"),
  },
});
