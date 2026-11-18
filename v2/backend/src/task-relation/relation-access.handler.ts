import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { AccessRuleHandler } from "../access/access-rule";
import { ProjectAccessService } from "../access/project-access.service";
import { WorkspaceMembershipService } from "../access/workspace-membership.service";
import type { ApiRequest } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import { TaskRelationEntity } from "../database/entities/task-relation.entity";
import { scopeOfTask } from "./scope-of-task";

/** Authorizes acting on a relation through its source task's workspace. */
@Injectable()
export class RelationAccessHandler implements AccessRuleHandler<void> {
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

    const manager = this.dataSource.manager;
    const id = request.params.id;
    const relation = await manager.findOne(TaskRelationEntity, {
      where: { id: typeof id === "string" ? id : "" },
      select: { sourceTaskId: true },
    });
    if (!relation) {
      throw new HTTPException(404, { message: "Task relation not found" });
    }

    const scope = await scopeOfTask(manager, relation.sourceTaskId);
    if (!scope) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    await this.membership.validateWorkspaceAccess(
      userId,
      scope.workspaceId,
      undefined,
      { notFoundMessage: "Task relation not found" },
    );
    await this.projectAccess.assertProjectAccess(userId, scope.projectId);
    request.workspaceId = scope.workspaceId;
  }
}
