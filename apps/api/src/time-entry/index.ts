import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createTimeEntry from "./controllers/create-time-entry";
import getActiveTimeEntry from "./controllers/get-active-time-entry";
import getTimeEntriesByTaskId from "./controllers/get-time-entries";
import getTimeEntry from "./controllers/get-time-entry";
import deleteTimeEntry from "./controllers/delete-time-entry";
import updateTimeEntry from "./controllers/update-time-entry";
import {
  activeTimeEntryResponseSchema,
  timeEntryListSchema,
  timeEntrySchema,
} from "./response";
import {
  createTimeEntryBody,
  taskIdParam,
  timeEntryParam,
  updateTimeEntryBody,
} from "./schema";

const getActiveTimeEntryRoute = createRoute({
  method: "get",
  operationId: "getActiveTimeEntry",
  path: "/active",
  tags: ["Time Entries"],
  summary: "Get active timer",
  description:
    "Return the current user's running time entry, if any, with task and project context.",
  responses: {
    200: jsonResponse(
      "Active running time entry, or null",
      activeTimeEntryResponseSchema,
    ),
    401: errorResponse("Unauthorized"),
  },
});

const getTaskTimeEntriesRoute = createRoute({
  method: "get",
  operationId: "getTaskTimeEntries",
  path: "/task/{taskId}",
  tags: ["Time Entries"],
  summary: "Get task time entries",
  description: "Get every time entry logged against a task.",
  middleware: [workspaceAccess.fromTaskId()] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of time entries for the task", timeEntryListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});

const getTimeEntryRoute = createRoute({
  method: "get",
  operationId: "getTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Get time entry",
  description: "Get a single time entry by ID.",
  middleware: [workspaceAccess.fromTimeEntry()] as const,
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("Time entry details", timeEntrySchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Time entry not found"),
  },
});

const createTimeEntryRoute = createRoute({
  method: "post",
  operationId: "createTimeEntry",
  path: "/",
  tags: ["Time Entries"],
  summary: "Create time entry",
  description:
    "Log time against a task. Omit endTime to start a running entry that can be closed later with an update.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTimeEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The created time entry", timeEntrySchema),
    400: errorResponse("Invalid body or timestamps"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

const deleteTimeEntryRoute = createRoute({
  method: "delete",
  operationId: "deleteTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Delete time entry",
  middleware: [
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("Deleted time entry", timeEntrySchema),
    403: errorResponse("Forbidden"),
    404: errorResponse("Not found"),
  },
});

const updateTimeEntryRoute = createRoute({
  method: "put",
  operationId: "updateTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Update time entry",
  description:
    "Replace a time entry's start, end, and description. Setting endTime closes a running entry and fills in its duration.",
  middleware: [
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: timeEntryParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTimeEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated time entry", timeEntrySchema),
    400: errorResponse("Invalid timestamps"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Time entry not found"),
  },
});

const timeEntry = apiRouter()
  .openapi(getActiveTimeEntryRoute, async (c) =>
    c.json({ running: await getActiveTimeEntry(c.get("userId")) }, 200),
  )
  .openapi(getTaskTimeEntriesRoute, async (c) =>
    c.json(await getTimeEntriesByTaskId(c.req.valid("param").taskId), 200),
  )
  .openapi(getTimeEntryRoute, async (c) =>
    c.json(await getTimeEntry(c.req.valid("param").id), 200),
  )
  .openapi(createTimeEntryRoute, async (c) => {
    const { taskId, startTime, endTime, description } = c.req.valid("json");
    return c.json(
      await createTimeEntry({
        taskId,
        userId: c.get("userId"),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        description,
      }),
      200,
    );
  })
  .openapi(updateTimeEntryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { startTime, endTime, description } = c.req.valid("json");
    return c.json(
      await updateTimeEntry({
        timeEntryId: id,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        description,
        actorUserId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(deleteTimeEntryRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await deleteTimeEntry(id, c.get("userId")), 200);
  });

export default timeEntry;
