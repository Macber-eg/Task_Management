import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
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

export const getActiveTimeEntryRoute = createRoute({
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

export const getTaskTimeEntriesRoute = createRoute({
  method: "get",
  operationId: "getTaskTimeEntries",
  path: "/task/{taskId}",
  tags: ["Time Entries"],
  summary: "Get task time entries",
  description: "Get every time entry logged against a task.",
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of time entries for the task", timeEntryListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});

export const getTimeEntryRoute = createRoute({
  method: "get",
  operationId: "getTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Get time entry",
  description: "Get a single time entry by ID.",
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("Time entry details", timeEntrySchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Time entry not found"),
  },
});

export const createTimeEntryRoute = createRoute({
  method: "post",
  operationId: "createTimeEntry",
  path: "/",
  tags: ["Time Entries"],
  summary: "Create time entry",
  description:
    "Log time against a task. Omit endTime to start a running entry that can be closed later with an update.",
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

export const deleteTimeEntryRoute = createRoute({
  method: "delete",
  operationId: "deleteTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Delete time entry",
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("Deleted time entry", timeEntrySchema),
    403: errorResponse("Forbidden"),
    404: errorResponse("Not found"),
  },
});

export const updateTimeEntryRoute = createRoute({
  method: "put",
  operationId: "updateTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Update time entry",
  description:
    "Replace a time entry's start, end, and description. Setting endTime closes a running entry and fills in its duration.",
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
