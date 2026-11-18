import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../common/openapi";
import { taskSchema } from "../response";
import {
  taskParam,
  updateStatusBody,
  updatePriorityBody,
  updateTaskEstimateBody,
  putTaskEstimateAllocationsBody,
  updateAssigneeBody,
  updatePhaseBody,
  updateSprintBody,
  updateDueDateBody,
  updateTitleBody,
  updateDescriptionBody,
} from "../schema";

export const updateTaskStatusRoute = createRoute({
  method: "put",
  operationId: "updateTaskStatus",
  path: "/status/{id}",
  tags: ["Tasks"],
  summary: "Update task status",
  description: "Move a task to another column in the same project.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateStatusBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskPriorityRoute = createRoute({
  method: "put",
  operationId: "updateTaskPriority",
  path: "/priority/{id}",
  tags: ["Tasks"],
  summary: "Update task priority",
  description: "Set a task's priority.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePriorityBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid priority"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskEstimateRoute = createRoute({
  method: "put",
  operationId: "updateTaskEstimate",
  path: "/estimate/{id}",
  tags: ["Tasks"],
  summary: "Update task estimate",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTaskEstimateBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    403: errorResponse("Forbidden"),
    404: errorResponse("Task not found"),
  },
});

export const putTaskEstimateAllocationsRoute = createRoute({
  method: "put",
  operationId: "putTaskEstimateAllocations",
  path: "/estimate-allocations/{id}",
  tags: ["Tasks"],
  summary: "Set per-member estimate allocations",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: putTaskEstimateAllocationsBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Allocations",
      z.array(z.record(z.string(), z.unknown())),
    ),
    400: errorResponse("Invalid allocations"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskAssigneeRoute = createRoute({
  method: "put",
  operationId: "updateTaskAssignee",
  path: "/assignee/{id}",
  tags: ["Tasks"],
  summary: "Update task assignee",
  description:
    "Assign a task to a workspace member, or send null to unassign it.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAssigneeBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:assign permission",
    ),
    404: errorResponse(
      "Task not found, or assignee is not a member of the workspace",
    ),
  },
});

export const updateTaskPhaseRoute = createRoute({
  method: "put",
  operationId: "updateTaskPhase",
  path: "/phase/{id}",
  tags: ["Tasks"],
  summary: "Update task phase",
  description: "Assign a delivery phase or clear it with null.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePhaseBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body or phase not in project"),
    403: errorResponse(
      "Phases disabled, no access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskSprintRoute = createRoute({
  method: "put",
  operationId: "updateTaskSprint",
  path: "/sprint/{id}",
  tags: ["Tasks"],
  summary: "Update task sprint",
  description: "Assign a sprint or clear it with null.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateSprintBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body or sprint not in project"),
    403: errorResponse(
      "Sprints disabled, no access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskDueDateRoute = createRoute({
  method: "put",
  operationId: "updateTaskDueDate",
  path: "/due-date/{id}",
  tags: ["Tasks"],
  summary: "Update task due date",
  description: "Set or clear a task's due date.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDueDateBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid date"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskTitleRoute = createRoute({
  method: "put",
  operationId: "updateTaskTitle",
  path: "/title/{id}",
  tags: ["Tasks"],
  summary: "Update task title",
  description: "Rename a task.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTitleBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskDescriptionRoute = createRoute({
  method: "put",
  operationId: "updateTaskDescription",
  path: "/description/{id}",
  tags: ["Tasks"],
  summary: "Update task description",
  description: "Replace a task's description.",
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDescriptionBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});
