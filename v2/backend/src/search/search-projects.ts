import type { EntityManager } from "typeorm";
import type { SearchResult, SearchScope } from "./search-result";
import { SqlParameters } from "./sql-parameters";
import { workspaceFilter } from "./workspace-filter";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  workspaceId: string;
  workspaceName: string | null;
  createdAt: Date;
  relevanceScore: number;
};

export async function searchProjects(
  manager: EntityManager,
  scope: SearchScope,
): Promise<SearchResult[]> {
  const parameters = new SqlParameters();
  const filter = workspaceFilter(scope, parameters);
  const relevance = `CASE
      WHEN LOWER(project.name) LIKE ${parameters.add(scope.pattern)} THEN 3
      WHEN LOWER(project.description) LIKE ${parameters.add(scope.pattern)} THEN 2
      ELSE 1
    END`;
  const nameMatch = parameters.add(scope.pattern);
  const descriptionMatch = parameters.add(scope.pattern);
  const limit = parameters.add(scope.limit);
  const projects = (await manager.query(
    `SELECT project.id, project.name, project.description, project.slug,
            project.workspace_id AS "workspaceId",
            workspace.name AS "workspaceName",
            project.created_at AS "createdAt",
            ${relevance} AS "relevanceScore"
     FROM project
     LEFT JOIN workspace ON project.workspace_id = workspace.id
     WHERE ${filter}
       AND (project.name ILIKE ${nameMatch}
         OR project.description ILIKE ${descriptionMatch})
     ORDER BY ${relevance} DESC, project.created_at DESC
     LIMIT ${limit}`,
    parameters.values,
  )) as ProjectRow[];

  return projects.map((project) => ({
    id: project.id,
    type: "project",
    title: project.name,
    description: project.description || undefined,
    projectId: project.id,
    projectSlug: project.slug || undefined,
    workspaceId: project.workspaceId,
    workspaceName: project.workspaceName || undefined,
    createdAt: project.createdAt,
    relevanceScore: project.relevanceScore,
  }));
}
