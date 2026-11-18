import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import { workflowRuleListSchema, workflowRuleRowSchema } from "./response";
import {
  projectIdParam,
  upsertWorkflowRuleBody,
  workflowRuleParam,
} from "./schema";

export const getWorkflowRulesRoute = createRoute({
  method: "get",
  operationId: "getWorkflowRules",
  path: "/{projectId}",
  tags: ["Workflow Rules"],
  summary: "Get workflow rules",
  description:
    "Get every workflow rule for a project. A rule moves a task to a column when an integration event fires.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("List of workflow rules", workflowRuleListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const upsertWorkflowRuleRoute = createRoute({
  method: "put",
  operationId: "upsertWorkflowRule",
  path: "/{projectId}",
  tags: ["Workflow Rules"],
  summary: "Upsert workflow rule",
  description:
    "Create a workflow rule, or update the target column of the existing rule for the same integration and event.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: upsertWorkflowRuleBody } },
    },
  },
  responses: {
    200: jsonResponse("The created or updated rule", workflowRuleRowSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const deleteWorkflowRuleRoute = createRoute({
  method: "delete",
  operationId: "deleteWorkflowRule",
  path: "/{id}",
  tags: ["Workflow Rules"],
  summary: "Delete workflow rule",
  description: "Delete a workflow rule. Returns the rule that was removed.",
  request: { params: workflowRuleParam },
  responses: {
    200: jsonResponse("The deleted rule", workflowRuleRowSchema),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Workflow rule not found"),
  },
});
