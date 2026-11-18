import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../common/openapi";
import {
  taskWithAssigneeSchema,
  taskByTicketIdSchema,
  boardSchema,
  taskExportSchema,
  descriptionPageSchema,
  descriptionMatchesSchema,
  projectSubtasksSchema,
  assignedTasksSchema,
} from "../response";
import {
  taskParam,
  ticketIdParam,
  ticketIdQuery,
  projectIdParam,
  assignedTasksQuery,
  listTasksQuery,
  descriptionPageQuery,
  descriptionMatchesQuery,
} from "../schema";

export const descriptionPageRoute = createRoute({
  method: "get",
  operationId: "getTaskDescriptionPage",
  path: "/{id}/description",
  tags: ["Tasks"],
  summary: "Read a description page",
  request: { params: taskParam, query: descriptionPageQuery },
  responses: {
    200: jsonResponse("Description page", descriptionPageSchema),
    400: errorResponse("Invalid offset or version"),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
    409: errorResponse("Description changed; reload from offset zero"),
    503: errorResponse("Description request timed out"),
  },
});

export const descriptionMatchesRoute = createRoute({
  method: "get",
  operationId: "findDeferredTaskDescriptions",
  path: "/description-matches/{projectId}",
  tags: ["Tasks"],
  summary: "Search descriptions omitted from task lists",
  request: { params: projectIdParam, query: descriptionMatchesQuery },
  responses: {
    200: jsonResponse("Matching task IDs", descriptionMatchesSchema),
    400: errorResponse("Invalid search query or cursor"),
    403: errorResponse("No access to the project"),
    503: errorResponse("Description search timed out"),
    404: errorResponse("Project not found"),
  },
});

export const listAssignedTasksRoute = createRoute({
  method: "get",
  operationId: "listAssignedTasks",
  path: "/assigned",
  tags: ["Tasks"],
  summary: "List my assigned tasks",
  description:
    "Get the open tasks assigned to the caller across a workspace's active projects. Completed and archived tasks are excluded. Ordered by due date (undated last), then priority. At most 100 tasks are returned; total counts all of them. Set countOnly=true to return just that total without loading task rows or labels.",
  request: { query: assignedTasksQuery },
  responses: {
    200: jsonResponse("Open tasks assigned to the caller", assignedTasksSchema),
    400: errorResponse("Invalid workspace ID or query parameters"),
    403: errorResponse("Missing project:read or task:read permission"),
    404: errorResponse("Workspace not found"),
  },
});

export const listProjectSubtasksRoute = createRoute({
  method: "get",
  operationId: "listProjectSubtasks",
  path: "/subtasks/{projectId}",
  tags: ["Tasks"],
  summary: "List subtasks grouped by parent task",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Subtasks by parent task id", projectSubtasksSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const listTasksRoute = createRoute({
  method: "get",
  operationId: "listTasks",
  path: "/tasks/{projectId}",
  tags: ["Tasks"],
  summary: "List tasks",
  description:
    "Get a project's board: its columns, each with the tasks in it, plus the archived and planned buckets. Responses always contain at most 100 tasks (50 by default). Continue through pagination.totalPages for the whole board, and for each task page follow relatedPage through pagination.relatedTotalPages for all labels, links and column metadata. Filters and sorting apply before pagination. Descriptions larger than 64 KiB are omitted with descriptionDeferred=true; read the task detail or description pages for full text.",
  request: { params: projectIdParam, query: listTasksQuery },
  responses: {
    200: jsonResponse("The project board", boardSchema),
    503: errorResponse("Task list request timed out"),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const getTaskByTicketIdRoute = createRoute({
  method: "get",
  operationId: "getTaskByTicketId",
  path: "/by-ticket-id/{ticketId}",
  tags: ["Tasks"],
  summary: "Get task by ticket ID",
  description:
    "Get a single task by its project key and number, such as KAN-12. A match in an active project takes precedence, then the most recently archived project. If the ticket ID still matches multiple accessible tasks, narrow the lookup to a workspace with workspaceId or workspaceSlug, or to a single project with projectId.",
  request: { params: ticketIdParam, query: ticketIdQuery },
  responses: {
    200: jsonResponse("Task details", taskByTicketIdSchema),
    400: errorResponse("Invalid ticket ID"),
    404: errorResponse("No accessible task has this ticket ID"),
    409: errorResponse("Ticket ID matches multiple accessible tasks"),
  },
});

export const getTaskRoute = createRoute({
  method: "get",
  operationId: "getTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Get task",
  description:
    "Get a single task by ID, with its assignee name. The board view omits descriptions above 64 KiB and includes task and same-project parent subtask progress.",
  request: {
    params: taskParam,
    query: z.object({ view: z.enum(["detail", "board"]).optional() }),
  },
  responses: {
    200: jsonResponse("Task details", taskWithAssigneeSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});

export const exportTasksRoute = createRoute({
  method: "get",
  operationId: "exportTasks",
  path: "/export/{projectId}",
  tags: ["Tasks"],
  summary: "Export tasks",
  description:
    "Export a project's tasks, with their labels, as a JSON document.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The exported project and tasks", taskExportSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const getTaskEstimateAllocationsRoute = createRoute({
  method: "get",
  operationId: "getTaskEstimateAllocations",
  path: "/estimate-allocations/{id}",
  tags: ["Tasks"],
  summary: "List per-member estimate allocations",
  request: { params: taskParam },
  responses: {
    200: jsonResponse(
      "Allocations",
      z.array(
        z.object({
          id: z.string(),
          taskId: z.string(),
          userId: z.string(),
          userName: z.string().nullable(),
          estimatedMinutes: z.number(),
        }),
      ),
    ),
    404: errorResponse("Task not found"),
  },
});
