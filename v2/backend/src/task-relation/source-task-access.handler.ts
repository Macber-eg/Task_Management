import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { AccessRuleHandler } from "../access/access-rule";
import { ProjectAccessService } from "../access/project-access.service";
import { WorkspaceMembershipService } from "../access/workspace-membership.service";
import type { ApiRequest } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import { scopeOfTask } from "./scope-of-task";

/**
 * Authorizes creating a relation against the source task's workspace and
 * project. Runs before body validation, so it reads the raw body.
 */
@Injectable()
export class SourceTaskAccessHandler implements AccessRuleHandler<void> {
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
    const raw =
      typeof body === "object" && body !== null
        ? (body as { sourceTaskId?: unknown }).sourceTaskId
        : undefined;
    const sourceTaskId = typeof raw === "string" ? raw : null;
    if (!sourceTaskId) {
      throw new HTTPException(400, { message: "sourceTaskId is required" });
    }

    const scope = await scopeOfTask(this.dataSource.manager, sourceTaskId);
    if (!scope) {
      throw new HTTPException(404, { message: "Source task not found" });
    }

    await this.membership.validateWorkspaceAccess(
      userId,
      scope.workspaceId,
      undefined,
      { notFoundMessage: "Source task not found" },
    );
    await this.projectAccess.assertProjectAccess(userId, scope.projectId);
    request.workspaceId = scope.workspaceId;
  }
}
