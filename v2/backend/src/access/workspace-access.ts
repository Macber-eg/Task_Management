import type { AccessRule } from "./access-rule";
import {
  WorkspaceAccessHandler,
  type WorkspaceAccessOptions,
  type WorkspaceIdSource,
} from "./workspace-access.handler";
import type { LookupResource } from "./workspace-scope.service";

function rule(sources: WorkspaceIdSource[]): AccessRule<WorkspaceAccessOptions> {
  return { handler: WorkspaceAccessHandler, options: { sources } };
}

/** A resource id in the path or JSON body, with `?workspaceId=` as fallback. */
function fromResource(resource: LookupResource, idKey: string) {
  return rule([
    { type: "lookup", resource, idKey },
    { type: "query", key: "workspaceId" },
  ]);
}

/**
 * Where a route's workspace comes from: named directly (query, body, param)
 * or derived from the resource the request acts on.
 */
export const workspaceAccess = {
  fromQuery: (key = "workspaceId") => rule([{ type: "query", key }]),
  fromBody: (key = "workspaceId") => rule([{ type: "body", key }]),
  fromParam: (key = "workspaceId") => rule([{ type: "param", key }]),

  fromProject: (idKey = "id") =>
    rule([{ type: "lookup", resource: "project", idKey }]),
  fromProjectId: (idKey = "projectId") => fromResource("project", idKey),
  fromTask: (idKey = "id") => fromResource("task", idKey),
  fromTaskId: (idKey = "taskId") => fromResource("task", idKey),
  fromTasks: (idKey = "taskIds") =>
    rule([{ type: "lookupMany", resource: "task", idKey }]),
  fromLabel: (idKey = "id") => fromResource("label", idKey),
  fromTimeEntry: (idKey = "id") => fromResource("timeEntry", idKey),
  fromActivity: (idKey = "id") => fromResource("activity", idKey),
  fromComment: (idKey = "id") => fromResource("comment", idKey),
  fromColumn: (idKey = "id") => fromResource("column", idKey),
  fromProjectPhase: (idKey = "id") => fromResource("projectPhase", idKey),
  fromProjectSprint: (idKey = "id") => fromResource("projectSprint", idKey),
  fromWorkflowRule: (idKey = "id") => fromResource("workflowRule", idKey),
  fromCustomField: (idKey = "id") =>
    rule([{ type: "lookup", resource: "customField", idKey }]),
};
