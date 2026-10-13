import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createPhase from "./controllers/create-phase";
import createSprint from "./controllers/create-sprint";
import deletePhase from "./controllers/delete-phase";
import deleteSprint from "./controllers/delete-sprint";
import getPhases from "./controllers/get-phases";
import getSprints from "./controllers/get-sprints";
import updatePhase from "./controllers/update-phase";
import reorderPhases from "./controllers/reorder-phases";
import reorderSprints from "./controllers/reorder-sprints";
import updateSprint from "./controllers/update-sprint";
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
  sprintParam,
  reorderPhasesBody,
  reorderSprintsBody,
  updatePhaseBody,
  updateSprintBody,
} from "./schema";

const getPhasesRoute = createRoute({
  method: "get",
  operationId: "getProjectPhases",
  path: "/phase/{projectId}",
  tags: ["Planning"],
  summary: "List project phases",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Phases ordered by position", phaseListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

const createPhaseRoute = createRoute({
  method: "post",
  operationId: "createProjectPhase",
  path: "/phase/{projectId}",
  tags: ["Planning"],
  summary: "Create phase",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
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

const updatePhaseRoute = createRoute({
  method: "put",
  operationId: "updateProjectPhase",
  path: "/phase/{id}",
  tags: ["Planning"],
  summary: "Update phase",
  middleware: [
    workspaceAccess.fromProjectPhase("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
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

const deletePhaseRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectPhase",
  path: "/phase/{id}",
  tags: ["Planning"],
  summary: "Delete phase",
  description: "Tasks in this phase are unassigned from the phase.",
  middleware: [
    workspaceAccess.fromProjectPhase("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: phaseParam },
  responses: {
    200: jsonResponse("Deleted phase", phaseSchema),
    403: errorResponse("No access or missing project:update permission"),
    404: errorResponse("Phase not found"),
  },
});

const getSprintsRoute = createRoute({
  method: "get",
  operationId: "getProjectSprints",
  path: "/sprint/{projectId}",
  tags: ["Planning"],
  summary: "List project sprints",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Sprints ordered by position", sprintListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

const createSprintRoute = createRoute({
  method: "post",
  operationId: "createProjectSprint",
  path: "/sprint/{projectId}",
  tags: ["Planning"],
  summary: "Create sprint",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
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

const updateSprintRoute = createRoute({
  method: "put",
  operationId: "updateProjectSprint",
  path: "/sprint/{id}",
  tags: ["Planning"],
  summary: "Update sprint",
  middleware: [
    workspaceAccess.fromProjectSprint("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
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

const reorderPhasesRoute = createRoute({
  method: "put",
  operationId: "reorderProjectPhases",
  path: "/phase/reorder/{projectId}",
  tags: ["Planning"],
  summary: "Reorder or move folders",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
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

const reorderSprintsRoute = createRoute({
  method: "put",
  operationId: "reorderProjectSprints",
  path: "/sprint/reorder/{projectId}",
  tags: ["Planning"],
  summary: "Reorder or move sprints",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
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

const deleteSprintRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectSprint",
  path: "/sprint/{id}",
  tags: ["Planning"],
  summary: "Delete sprint",
  description: "Tasks in this sprint are unassigned from the sprint.",
  middleware: [
    workspaceAccess.fromProjectSprint("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: sprintParam },
  responses: {
    200: jsonResponse("Deleted sprint", sprintSchema),
    403: errorResponse("No access or missing project:update permission"),
    404: errorResponse("Sprint not found"),
  },
});

const planning = apiRouter()
  .openapi(getPhasesRoute, async (c) =>
    c.json(await getPhases(c.req.valid("param").projectId), 200),
  )
  .openapi(createPhaseRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    return c.json(await createPhase({ projectId, ...body }), 200);
  })
  .openapi(updatePhaseRoute, async (c) =>
    c.json(
      await updatePhase(c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  )
  .openapi(deletePhaseRoute, async (c) =>
    c.json(await deletePhase(c.req.valid("param").id), 200),
  )
  .openapi(reorderPhasesRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { phases } = c.req.valid("json");
    return c.json(await reorderPhases(projectId, phases), 200);
  })
  .openapi(getSprintsRoute, async (c) =>
    c.json(await getSprints(c.req.valid("param").projectId), 200),
  )
  .openapi(createSprintRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    return c.json(await createSprint({ projectId, ...body }), 200);
  })
  .openapi(updateSprintRoute, async (c) =>
    c.json(
      await updateSprint(c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  )
  .openapi(deleteSprintRoute, async (c) =>
    c.json(await deleteSprint(c.req.valid("param").id), 200),
  )
  .openapi(reorderSprintsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { sprints } = c.req.valid("json");
    return c.json(await reorderSprints(projectId, sprints), 200);
  });

export default planning;
