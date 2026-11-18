import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ProjectAccessService } from "../access/project-access.service";
import { searchActivities } from "./search-activities";
import { searchProjects } from "./search-projects";
import type { SearchResult, SearchType } from "./search-result";
import { searchTasks } from "./search-tasks";
import { searchWorkspaces } from "./search-workspaces";

export type SearchParams = {
  query: string;
  userEmail?: string;
  userId?: string;
  type?: SearchType;
  workspaceId?: string;
  projectId?: string;
  limit?: number;
};

export type SearchResponse = {
  results: SearchResult[];
  totalCount: number;
  searchQuery: string;
};

@Injectable()
export class GlobalSearchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** Ranked matches across the kinds `type` selects, best first. */
  async globalSearch(params: SearchParams): Promise<SearchResponse> {
    const { query, type = "all", workspaceId, projectId, limit = 20 } = params;
    const manager = this.dataSource.manager;
    const empty = { results: [], totalCount: 0, searchQuery: query };

    const userId = await this.resolveUserId(params);
    if (!userId) return empty;

    const memberships = (await manager.query(
      'SELECT workspace_id AS "workspaceId" FROM workspace_member WHERE user_id = $1',
      [userId],
    )) as { workspaceId: string | null }[];
    const accessibleWorkspaceIds = memberships
      .map((membership) => membership.workspaceId)
      .filter((id): id is string => Boolean(id));

    if (
      accessibleWorkspaceIds.length === 0 ||
      (projectId &&
        (
          await this.projectAccess.findInaccessibleProjectIds(userId, [
            projectId,
          ])
        ).length > 0)
    ) {
      return empty;
    }

    const scope = {
      userId,
      workspaceId,
      accessibleWorkspaceIds,
      projectId,
      limit,
      pattern: `%${query.toLowerCase()}%`,
    };
    const results: SearchResult[] = [];

    if (type === "all" || type === "tasks")
      results.push(...(await searchTasks(manager, query, scope)));
    if (type === "all" || type === "projects")
      results.push(...(await searchProjects(manager, scope)));
    if (type === "all" || type === "workspaces")
      results.push(...(await searchWorkspaces(manager, scope)));
    if (type === "all" || type === "comments" || type === "activities")
      results.push(
        ...(await searchActivities(manager, scope, type === "comments")),
      );

    results.sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return {
      results: results.slice(0, limit),
      totalCount: results.length,
      searchQuery: query,
    };
  }

  /** The caller, or the user a `userEmail` names when there is no caller. */
  private async resolveUserId(params: SearchParams) {
    if (params.userId || !params.userEmail) return params.userId;
    const [user] = (await this.dataSource.manager.query(
      `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
      [params.userEmail],
    )) as { id: string }[];
    return user?.id;
  }
}
