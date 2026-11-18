import { projectAccessCondition } from "../access/project-access-condition";
import type { SearchScope } from "./search-result";
import type { SqlParameters } from "./sql-parameters";

/** Projects in the searched workspace(s) that the user may see. */
export function workspaceFilter(scope: SearchScope, parameters: SqlParameters) {
  const workspace = scope.workspaceId
    ? `project.workspace_id = ${parameters.add(scope.workspaceId)}`
    : `project.workspace_id = ANY(${parameters.add(scope.accessibleWorkspaceIds)}::text[])`;
  return `${workspace} AND ${projectAccessCondition(
    parameters.add(scope.userId),
    "project.id",
  )}`;
}
