import { Injectable } from "@nestjs/common";
import type { ApiRequest } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import type { AccessRuleHandler } from "./access-rule";
import { ProjectAccessService } from "./project-access.service";
import { WorkspaceMembershipService } from "./workspace-membership.service";
import {
  type LookupResource,
  WorkspaceScopeService,
} from "./workspace-scope.service";

export type WorkspaceIdSource =
  | { type: "query"; key: string }
  | { type: "body"; key: string }
  | { type: "param"; key: string }
  | { type: "lookup"; resource: LookupResource; idKey: string }
  | { type: "lookupMany"; resource: "task"; idKey: string };

export type WorkspaceAccessOptions = { sources: WorkspaceIdSource[] };

const WORKSPACE_NOT_FOUND = "Workspace not found";
const TASKS_NOT_FOUND = "No tasks found";

const RESOURCE_NOT_FOUND: Record<LookupResource, string> = {
  project: "Project not found",
  task: "Task not found",
  label: "Label not found",
  timeEntry: "Time entry not found",
  activity: "Activity not found",
  comment: "Comment not found",
  column: "Column not found",
  projectPhase: "Phase not found",
  projectSprint: "Sprint not found",
  workflowRule: "Workflow rule not found",
  customField: "Custom field not found",
};

function jsonObjectBody(request: ApiRequest): Record<string, unknown> {
  const raw: unknown = request.body;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function firstString(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first ? first : null;
}

/**
 * Resolves the workspace a request targets, then requires the caller to be a
 * member of it and to have access to the project(s) involved. Sets
 * `request.workspaceId` for the rules and handler that follow.
 */
@Injectable()
export class WorkspaceAccessHandler implements AccessRuleHandler<WorkspaceAccessOptions> {
  constructor(
    private readonly scopes: WorkspaceScopeService,
    private readonly membership: WorkspaceMembershipService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async check(
    request: ApiRequest,
    options: WorkspaceAccessOptions,
  ): Promise<void> {
    const principal = request.principal;
    if (!principal?.userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    let workspaceId: string | null = null;
    let projectIds: string[] = [];
    let notFoundMessage = WORKSPACE_NOT_FOUND;

    for (const source of options.sources) {
      if (source.type === "query") {
        workspaceId = firstString(request.query[source.key]);
      } else if (source.type === "body") {
        const bodyValue = jsonObjectBody(request)[source.key];
        workspaceId = typeof bodyValue === "string" ? bodyValue : null;
      } else if (source.type === "param") {
        workspaceId = firstString(request.params[source.key]);
      } else if (source.type === "lookup") {
        const bodyId = jsonObjectBody(request)[source.idKey];
        const idFromBody = typeof bodyId === "string" ? bodyId : null;
        // Only accept the id from the same place the handler will read it
        // (path param or JSON body). Accepting it from the query string let a
        // caller authorize against one resource (`?taskId=<mine>`) while the
        // handler acted on another (`{"taskId": "<someone else's>"}`).
        const id = firstString(request.params[source.idKey]) || idFromBody;
        if (id) {
          notFoundMessage = RESOURCE_NOT_FOUND[source.resource];
          const scope = await this.scopes.lookupScope(source.resource, id);
          if (!scope) {
            throw new HTTPException(404, { message: notFoundMessage });
          }
          workspaceId = scope.workspaceId;
          projectIds = scope.projectId ? [scope.projectId] : [];
        }
      } else {
        const ids = jsonObjectBody(request)[source.idKey];
        if (Array.isArray(ids)) {
          const taskIds = ids.filter(
            (id): id is string => typeof id === "string",
          );
          if (taskIds.length > 0) {
            notFoundMessage = TASKS_NOT_FOUND;
            const tasks = await this.scopes.lookupTaskScopes(taskIds);
            const workspaceIds = [
              ...new Set(tasks.map((task) => task.workspaceId)),
            ];
            if (workspaceIds.length === 0) {
              throw new HTTPException(404, { message: notFoundMessage });
            }
            if (workspaceIds.length > 1) {
              throw new HTTPException(400, {
                message: "All tasks must belong to the same workspace",
              });
            }
            workspaceId = workspaceIds[0] ?? null;
            projectIds = [...new Set(tasks.map((task) => task.projectId))];
          }
        }
      }

      if (workspaceId) break;
    }

    if (!workspaceId) {
      throw new HTTPException(400, {
        message: "Workspace ID could not be determined",
      });
    }

    await this.membership.validateWorkspaceAccess(
      principal.userId,
      workspaceId,
      principal.apiKey?.id,
      { notFoundMessage },
    );
    await this.projectAccess.assertProjectAccess(principal.userId, projectIds);

    request.workspaceId = workspaceId;
  }
}
