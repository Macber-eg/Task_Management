import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { hasInstanceAdminRole } from "../access/instance-admin-role";
import { EventBus } from "../events/event-bus";
import { clearMemberProjectAccess } from "../project-access/clear-member-project-access";
import { publishMemberProjects } from "../project-access/publish-member-projects";
import { RealtimeConnections } from "../realtime/realtime-connections";
import { WorkspaceSeatSync } from "./workspace-seat-sync";

/** What has to follow a membership change, wherever the change was made. */
@Injectable()
export class WorkspaceMemberLifecycleService {
  private readonly logger = new Logger(WorkspaceMemberLifecycleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly realtime: RealtimeConnections,
    private readonly seatSync: WorkspaceSeatSync,
  ) {}

  async handleMemberAdded(workspaceId: string, userId: string): Promise<void> {
    await publishMemberProjects(
      this.dataSource.manager,
      this.events,
      workspaceId,
      userId,
    ).catch((error: unknown) => {
      this.logger.error("Project member refresh failed:", error);
    });
    this.syncSeats(workspaceId, "Seat sync after member add failed:");
  }

  async handleMemberRemoved(removal: {
    workspaceId: string;
    userId: string;
    userRole: string | null | undefined;
  }): Promise<void> {
    const { workspaceId, userId, userRole } = removal;
    await clearMemberProjectAccess(
      this.dataSource.manager,
      workspaceId,
      userId,
    ).catch((error: unknown) => {
      this.logger.error("Project access cleanup failed:", error);
    });
    await this.events.publish("project_members.updated", { workspaceId });
    // An instance admin keeps access to every workspace without a membership.
    if (!hasInstanceAdminRole(userRole)) {
      await this.realtime.revokeWorkspaceConnections(userId, workspaceId, {
        role: userRole ?? null,
      });
    }
    this.syncSeats(workspaceId, "Seat sync after member remove failed:");
  }

  async handleOwnerPromoted(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await clearMemberProjectAccess(this.dataSource.manager, workspaceId, userId)
      .then(() =>
        this.events.publish("project_access.updated", { workspaceId, userId }),
      )
      .catch((error: unknown) => {
        this.logger.error("Project access cleanup failed:", error);
      });
  }

  // Not awaited: billing must never delay or fail a membership change.
  private syncSeats(workspaceId: string, failureMessage: string): void {
    this.seatSync
      .syncWorkspaceSeats(workspaceId)
      .catch((error: unknown) => this.logger.error(failureMessage, error));
  }
}
