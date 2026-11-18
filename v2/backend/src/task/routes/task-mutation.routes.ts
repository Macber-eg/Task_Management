import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../common/openapi";
import {
  taskSchema,
  bulkResultSchema,
  moveTaskResultSchema,
  taskImportResultSchema,
} from "../response";
import {
  taskParam,
  projectIdParam,
  bulkUpdateBody,
  createTaskBody,
  updateTaskBody,
  moveTaskBody,
  importTasksBody,
  duplicateTaskBody,
  reorderTasksBody,
} from "../schema";

export const bulkUpdateTasksRoute = createRoute({
  method: "patch",
  operationId: "bulkUpdateTasks",
  path: "/bulk",
  tags: ["Tasks"],
  summary: "Bulk update tasks",
  description:
    "Apply one operation to many tasks at once. Every task must be in the same workspace.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bulkUpdateBody } },
    },
  },
  responses: {
    200: jsonResponse("Bulk operation result", bulkResultSchema),
    400: errorResponse(
      "Invalid body, or the tasks span more than one workspace",
    ),
    403: errorResponse(
      "No access to the project, or missing the permission the operation needs",
    ),
    404: errorResponse("No tasks found"),
    409: errorResponse("Tasks changed projects; retry the operation"),
  },
});

export const reorderTasksRoute = createRoute({
  method: "post",
  operationId: "reorderTasks",
  path: "/reorder",
  tags: ["Tasks"],
  summary: "Reorder or move cards",
  description:
    "Atomically update positions and optional column status for cards in one project. Other task fields are preserved.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: reorderTasksBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated card positions and statuses",
      z
        .object({ id: z.string(), position: z.number(), status: z.string() })
        .array(),
    ),
    400: errorResponse("Invalid positions or column"),
    403: errorResponse("Missing task:update permission"),
    404: errorResponse(
      "Project not found, or tasks do not belong to the project",
    ),
    409: errorResponse(
      "Board changed or task moved; refresh before reordering",
    ),
  },
});

export const createTaskRoute = createRoute({
  method: "post",
  operationId: "createTask",
  path: "/{projectId}",
  tags: ["Tasks"],
  summary: "Create task",
  description:
    "Add a task to a project. It is placed in the column named by `status`.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The created task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:create permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const duplicateTaskRoute = createRoute({
  method: "post",
  path: "/duplicate/{id}",
  operationId: "duplicateTask",
  tags: ["Tasks"],
  summary: "Duplicate a task",
  description:
    "Copy a task into the same project and column, including custom fields, labels, description assets and same-workspace parent links. Copying parent links also requires task:update. Comments, time entries and child tasks are not copied.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: duplicateTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The duplicated task", taskSchema),
    400: errorResponse("Invalid task fields or request"),
    401: errorResponse("Unauthorized"),
    403: errorResponse(
      "No access to the project, missing task:create, or missing task:update when copying parent links",
    ),
    404: errorResponse("Task or project not found"),
    409: errorResponse("Task column has reached its capacity"),
    503: errorResponse("Unable to copy task attachments"),
  },
});

export const moveTaskRoute = createRoute({
  method: "put",
  operationId: "moveTask",
  path: "/move/{id}",
  tags: ["Tasks"],
  summary: "Move task",
  description:
    "Move a task to another project, optionally into a named column. Both projects must be in the same workspace.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: moveTaskBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The moved task, with both project ids",
      moveTaskResultSchema,
    ),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task or destination project not found"),
    409: errorResponse("Task or project moved concurrently; retry the move"),
  },
});

export const updateTaskRoute = createRoute({
  method: "put",
  operationId: "updateTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Update task",
  description:
    "Replace every field of a task. Use the single-field routes for narrower edits.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:update or task:assign permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const importTasksRoute = createRoute({
  method: "post",
  operationId: "importTasks",
  path: "/import/{projectId}",
  tags: ["Tasks"],
  summary: "Import tasks",
  description:
    "Import tasks into a project. Each task is reported individually, so a partial import still returns 200.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: importTasksBody } },
    },
  },
  responses: {
    200: jsonResponse("Per-task import outcome", taskImportResultSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:create permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const deleteTaskRoute = createRoute({
  method: "delete",
  operationId: "deleteTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Delete task",
  description:
    "Permanently delete a task and its comments, labels, and time entries.",
  request: { params: taskParam },
  responses: {
    200: jsonResponse("The deleted task", taskSchema),
    409: errorResponse("Task changed projects; retry the operation"),
    403: errorResponse(
      "No access to the project, or missing task:delete permission",
    ),
    404: errorResponse("Task not found"),
  },
});
