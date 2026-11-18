import type { EntityManager } from "typeorm";
import type { SearchResult, SearchScope } from "./search-result";
import { SqlParameters } from "./sql-parameters";

type WorkspaceRow = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  relevanceScore: number;
};

export async function searchWorkspaces(
  manager: EntityManager,
  scope: SearchScope,
): Promise<SearchResult[]> {
  const parameters = new SqlParameters();
  const relevance = `CASE
      WHEN LOWER(workspace.name) LIKE ${parameters.add(scope.pattern)} THEN 3
      WHEN LOWER(workspace.description) LIKE ${parameters.add(scope.pattern)} THEN 2
      ELSE 1
    END`;
  const accessible = parameters.add(scope.accessibleWorkspaceIds);
  const nameMatch = parameters.add(scope.pattern);
  const descriptionMatch = parameters.add(scope.pattern);
  const limit = parameters.add(scope.limit);
  // The member join repeats a workspace once per member, as it always has.
  const workspaces = (await manager.query(
    `SELECT workspace.id, workspace.name, workspace.description,
            workspace.created_at AS "createdAt",
            ${relevance} AS "relevanceScore"
     FROM workspace
     LEFT JOIN workspace_member
       ON workspace.id = workspace_member.workspace_id
     WHERE workspace.id = ANY(${accessible}::text[])
       AND (workspace.name ILIKE ${nameMatch}
         OR workspace.description ILIKE ${descriptionMatch})
     ORDER BY ${relevance} DESC, workspace.created_at DESC
     LIMIT ${limit}`,
    parameters.values,
  )) as WorkspaceRow[];

  return workspaces.map((workspace) => ({
    id: workspace.id,
    type: "workspace",
    title: workspace.name,
    description: workspace.description || undefined,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    createdAt: workspace.createdAt,
    relevanceScore: workspace.relevanceScore,
  }));
}
