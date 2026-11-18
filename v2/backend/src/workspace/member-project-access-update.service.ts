import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { EventBus } from "../events/event-bus";
import { AccessChangeLock } from "../project-access/access-change-lock";
import { HiddenGrantsService } from "../project-access/hidden-grants.service";
import { listAccessibleProjectIds } from "../project-access/list-accessible-project-ids";
import type { ProjectAccessMode } from "../project-access/project-access-mode";
import { ProjectAccessRequestService } from "../project-access/project-access-request.service";
import { replaceMemberProjectAccess } from "../project-access/replace-member-project-access";
import { unassignInaccessibleTasks } from "../project-access/unassign-inaccessible-tasks";

@Injectable()
export class MemberProjectAccessUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly accessChangeLock: AccessChangeLock,
    private readonly accessRequests: ProjectAccessRequestService,
    private readonly hiddenGrants: HiddenGrantsService,
  ) {}

  async updateMemberProjectAccess(request: {
    workspaceId: string;
    actorId: string;
    userId: string;
    projectAccess: ProjectAccessMode;
    projectIds: string[];
  }) {
    const { workspaceId, actorId, userId } = request;

    if (actorId === userId) {
      throw new HTTPException(403, {
        message: "You can't change your own project access",
      });
    }

    const { access, changedProjectIds, unassigned } =
      await this.dataSource.transaction(async (manager) => {
        const lock = await this.accessChangeLock.lockAccessChange(manager, {
          workspaceId,
          actorId,
          userId,
        });
        if (!lock.actorAllowed) {
          throw new HTTPException(403, { message: "Insufficient permissions" });
        }
        if (lock.targetRole === null) {
          throw new HTTPException(404, { message: "Member not found" });
        }

        const resolution =
          await this.accessRequests.resolveProjectAccessRequest({
            workspaceId,
            actorId,
            targetRole: lock.targetRole,
            projectAccess: request.projectAccess,
            projectIds: request.projectIds,
            manager,
          });
        if (!resolution.ok) {
          throw new HTTPException(resolution.status, {
            message: resolution.message,
          });
        }

        const outcome = await this.hiddenGrants.keepHiddenGrants({
          workspaceId,
          actorId,
          userId,
          access: resolution.access,
          manager,
        });
        if (!outcome.ok) {
          throw new HTTPException(403, { message: outcome.message });
        }

        const before = await listAccessibleProjectIds(
          manager,
          workspaceId,
          userId,
        );
        await replaceMemberProjectAccess(manager, {
          workspaceId,
          userId,
          ...outcome.access,
        });
        const after = await listAccessibleProjectIds(
          manager,
          workspaceId,
          userId,
        );
        return {
          access: resolution.access,
          changedProjectIds: [
            ...[...before].filter((projectId) => !after.has(projectId)),
            ...[...after].filter((projectId) => !before.has(projectId)),
          ],
          unassigned: await unassignInaccessibleTasks(manager, {
            workspaceId,
            userId,
            actorId,
          }),
        };
      });

    await this.events.publish("project_access.updated", {
      workspaceId,
      userId,
      projectIds: changedProjectIds,
    });
    for (const projectId of new Set(unassigned.map((task) => task.projectId))) {
      await this.events.publish("task.bulk_unassigned", {
        projectId,
        userId: actorId,
      });
    }

    return { userId, ...access };
  }
}
