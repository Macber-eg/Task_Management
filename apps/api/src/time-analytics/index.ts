import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getProjectTimeReport from "./controllers/get-project-time-report";
import getWorkloadReport from "./controllers/get-workload-report";
import { loadTimesheetRows } from "./load-project-time-data";
import { z } from "../openapi";

const projectIdParam = z.object({ projectId: z.string() });

const reportQuery = z.object({
  phaseId: z.string().optional(),
  sprintId: z.string().optional(),
});

const timesheetQuery = z.object({
  workspaceId: z.string(),
  projectId: z.string().optional(),
  phaseId: z.string().optional(),
  sprintId: z.string().optional(),
  taskId: z.string().optional(),
  userId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const workloadQuery = z.object({
  workspaceId: z.string(),
  projectId: z.string().optional(),
  userId: z.string().optional(),
  from: z.string(),
  to: z.string(),
});

const getProjectReportRoute = createRoute({
  method: "get",
  operationId: "getProjectTimeReport",
  path: "/project/{projectId}",
  tags: ["Time Analytics"],
  summary: "Project time analytics",
  middleware: [workspaceAccess.fromProjectId()] as const,
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

const getTimesheetsRoute = createRoute({
  method: "get",
  operationId: "getTimesheets",
  path: "/timesheets",
  tags: ["Time Analytics"],
  summary: "Filtered timesheet rows",
  middleware: [
    workspaceAccess.fromQuery("workspaceId"),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { query: timesheetQuery },
  responses: {
    200: jsonResponse(
      "Timesheet rows",
      z.array(z.record(z.string(), z.unknown())),
    ),
    403: errorResponse("Forbidden"),
  },
});

const getWorkloadRoute = createRoute({
  method: "get",
  operationId: "getWorkloadReport",
  path: "/workload",
  tags: ["Time Analytics"],
  summary: "Resource workload",
  middleware: [
    workspaceAccess.fromQuery("workspaceId"),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { query: workloadQuery },
  responses: {
    200: jsonResponse(
      "Workload rows",
      z.array(z.record(z.string(), z.unknown())),
    ),
    403: errorResponse("Forbidden"),
  },
});

const timeAnalytics = apiRouter()
  .openapi(getProjectReportRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const query = c.req.valid("query");
    return c.json(
      await getProjectTimeReport(projectId, {
        phaseId: query.phaseId,
        sprintId: query.sprintId,
      }),
      200,
    );
  })
  .openapi(getTimesheetsRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await loadTimesheetRows({
        workspaceId: query.workspaceId,
        projectId: query.projectId,
        phaseId: query.phaseId,
        sprintId: query.sprintId,
        taskId: query.taskId,
        userId: query.userId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      }),
      200,
    );
  })
  .openapi(getWorkloadRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await getWorkloadReport({
        workspaceId: query.workspaceId,
        projectId: query.projectId,
        userId: query.userId,
        from: new Date(query.from),
        to: new Date(query.to),
      }),
      200,
    );
  });

export default timeAnalytics;
