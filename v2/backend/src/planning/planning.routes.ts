import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  phaseListSchema,
  phaseSchema,
  sprintListSchema,
  sprintSchema,
} from "./response";
import {
  createPhaseBody,
  createSprintBody,
  phaseParam,
  projectIdParam,
  reorderPhasesBody,
  reorderSprintsBody,
  sprintParam,
  updatePhaseBody,
  updateSprintBody,
} from "./schema";

export const getPhasesRoute = createRoute({
  method: "get",
  operationId: "getProjectPhases",
  path: "/phase/{projectId}",
  tags: ["Planning"],
  summary: "List project phases",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Phases ordered by position", phaseListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createPhaseRoute = createRoute({
  method: "post",
  operationId: "createProjectPhase",
  path: "/phase/{projectId}",
  tags: ["Planning"],
  summary: "Create phase",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createPhaseBody } },
    },
  },
  responses: {
    200: jsonResponse("Created phase", phaseSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "Phases disabled, no access, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updatePhaseRoute = createRoute({
  method: "put",
  operationId: "updateProjectPhase",
  path: "/phase/{id}",
  tags: ["Planning"],
  summary: "Update phase",
  request: {
    params: phaseParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePhaseBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated phase", phaseSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("No access or missing project:update permission"),
    404: errorResponse("Phase not found"),
  },
});

export const deletePhaseRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectPhase",
  path: "/phase/{id}",
  tags: ["Planning"],
  summary: "Delete phase",
  description: "Tasks in this phase are unassigned from the phase.",
  request: { params: phaseParam },
  responses: {
    200: jsonResponse("Deleted phase", phaseSchema),
    403: errorResponse("No access or missing project:update permission"),
    404: errorResponse("Phase not found"),
  },
});

export const getSprintsRoute = createRoute({
  method: "get",
  operationId: "getProjectSprints",
  path: "/sprint/{projectId}",
  tags: ["Planning"],
  summary: "List project sprints",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Sprints ordered by position", sprintListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createSprintRoute = createRoute({
  method: "post",
  operationId: "createProjectSprint",
  path: "/sprint/{projectId}",
  tags: ["Planning"],
  summary: "Create sprint",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createSprintBody } },
    },
  },
  responses: {
    200: jsonResponse("Created sprint", sprintSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "Sprints disabled, no access, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateSprintRoute = createRoute({
  method: "put",
  operationId: "updateProjectSprint",
  path: "/sprint/{id}",
  tags: ["Planning"],
  summary: "Update sprint",
  request: {
    params: sprintParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateSprintBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated sprint", sprintSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("No access or missing project:update permission"),
    404: errorResponse("Sprint not found"),
  },
});

export const reorderPhasesRoute = createRoute({
  method: "put",
  operationId: "reorderProjectPhases",
  path: "/phase/reorder/{projectId}",
  tags: ["Planning"],
  summary: "Reorder or move folders",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: reorderPhasesBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated folders", phaseListSchema),
    400: errorResponse("Invalid body or folder hierarchy"),
    403: errorResponse("No access or missing project:update permission"),
  },
});

export const reorderSprintsRoute = createRoute({
  method: "put",
  operationId: "reorderProjectSprints",
  path: "/sprint/reorder/{projectId}",
  tags: ["Planning"],
  summary: "Reorder or move sprints",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: reorderSprintsBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated sprints", sprintListSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("No access or missing project:update permission"),
  },
});

export const deleteSprintRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectSprint",
  path: "/sprint/{id}",
  tags: ["Planning"],
  summary: "Delete sprint",
  description: "Tasks in this sprint are unassigned from the sprint.",
  request: { params: sprintParam },
  responses: {
    200: jsonResponse("Deleted sprint", sprintSchema),
    403: errorResponse("No access or missing project:update permission"),
    404: errorResponse("Sprint not found"),
  },
});
