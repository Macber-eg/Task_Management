import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../common/openapi";
import {
  resumeBody,
  resumeParams,
  resumePreviewSchema,
  rulesBody,
  saveRulesBody,
  syncParams,
  syncPreviewSchema,
} from "./schema";

const errors = {
  400: errorResponse("Invalid rule or workspace label"),
  403: errorResponse(
    "No access to the project, or missing required permission",
  ),
  404: errorResponse("Project, integration, or linked task not found"),
  409: errorResponse(
    "Configuration, impact or comparison changed; review again",
  ),
};
const path = "/project/{projectId}/{provider}";
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const getSyncRulesRoute = createRoute({
  method: "get",
  path,
  operationId: "getIntegrationSyncRules",
  tags: ["Integration sync"],
  summary: "Get sync rules and current task scope",
  description:
    "Workspace members with project and task read permissions can inspect saved rules. Rules remain active when advanced mode is hidden. Paused issue links are preserved; eligible paused tasks require review before resuming.",
  request: {
    params: syncParams,
    query: z.object({ after: z.string().optional() }),
  },
  responses: {
    200: jsonResponse("Saved rules and scope", syncPreviewSchema),
    ...errors,
  },
});

export const previewSyncRulesRoute = createRoute({
  method: "post",
  path: `${path}/preview`,
  operationId: "previewIntegrationSyncRules",
  tags: ["Integration sync"],
  summary: "Preview a sync rule change",
  description:
    "Returns matching tasks, new exports, paused links and a token bound to the current integration and impact. Outgoing labels are workspace label IDs; incoming labels are exact repository label names.",
  request: { params: syncParams, body: body(rulesBody) },
  responses: {
    200: jsonResponse("Proposed rule impact", syncPreviewSchema),
    ...errors,
  },
});

export const saveSyncRulesRoute = createRoute({
  method: "patch",
  path,
  operationId: "saveIntegrationSyncRules",
  tags: ["Integration sync"],
  summary: "Apply a previewed sync rule",
  description:
    "Save shared integration rules only if the preview is still current. Excluded links are paused, never deleted. Newly matching unlinked tasks are exported through the integration event path. Paused links require explicit review to resume.",
  request: { params: syncParams, body: body(saveRulesBody) },
  responses: {
    200: jsonResponse("Saved rules and current scope", syncPreviewSchema),
    ...errors,
  },
});

export const reviewSyncResumeRoute = createRoute({
  method: "get",
  path: `${path}/links/{linkId}/review`,
  operationId: "reviewIntegrationSyncResume",
  tags: ["Integration sync"],
  summary: "Compare a paused task with its external issue",
  request: { params: resumeParams },
  responses: {
    200: jsonResponse(
      "Current values and comparison token",
      resumePreviewSchema,
    ),
    ...errors,
    502: errorResponse("External issue unavailable; sync remains paused"),
  },
});

export const resumeSyncRoute = createRoute({
  method: "post",
  path: `${path}/links/{linkId}/resume`,
  operationId: "resumeIntegrationSync",
  tags: ["Integration sync"],
  summary: "Resume a reviewed issue link",
  description:
    "Explicitly choose the current Kaneo or repository title, description and open/closed state. Existing links are reused; historical comments are not replayed. The task must still match its outgoing rule. A changed comparison requires another review.",
  request: { params: resumeParams, body: body(resumeBody) },
  responses: {
    200: jsonResponse("Sync resumed", z.object({ success: z.boolean() })),
    ...errors,
    409: errorResponse(
      "Comparison changed or synchronization is busy; review or retry",
    ),
    502: errorResponse("External issue unavailable; sync remains paused"),
  },
});
