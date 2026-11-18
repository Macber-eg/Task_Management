import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { AccessRuleHandler } from "../../access/access-rule";
import { ProjectAccessService } from "../../access/project-access.service";
import { WorkspaceMembershipService } from "../../access/workspace-membership.service";
import type { ApiRequest } from "../../auth/principal";
import { HTTPException } from "../../common/errors/http-exception";

/**
 * Authorizes a request against the project named by `projectId` in its JSON
 * body (integration imports and repository verification), then sets
 * `request.workspaceId`. Access rules run before validation, so the raw body
 * is read here.
 */
@Injectable()
export class ScopeToProjectFromBodyHandler implements AccessRuleHandler<void> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly membership: WorkspaceMembershipService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async check(request: ApiRequest): Promise<void> {
    const userId = request.principal?.userId;
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const body: unknown = request.body;
    const projectId =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { projectId?: unknown }).projectId === "string"
        ? (body as { projectId: string }).projectId
        : null;
    if (!projectId) {
      throw new HTTPException(400, { message: "projectId is required" });
    }

    const [project] = (await this.dataSource.query(
      `SELECT workspace_id AS "workspaceId" FROM project WHERE id = $1 LIMIT 1`,
      [projectId],
    )) as { workspaceId: string }[];
    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    await this.membership.validateWorkspaceAccess(
      userId,
      project.workspaceId,
      request.principal?.apiKey?.id,
      { notFoundMessage: "Project not found" },
    );
    await this.projectAccess.assertProjectAccess(userId, projectId);
    request.workspaceId = project.workspaceId;
  }
}
