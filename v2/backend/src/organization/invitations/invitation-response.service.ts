import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { SessionService } from "../../auth/sessions/session.service";
import { insertReturning, updateReturning } from "../../database/dml";
import { InvitationEntity } from "../../database/entities/invitation.entity";
import { TeamEntity } from "../../database/entities/team.entity";
import { TeamMemberEntity } from "../../database/entities/team-member.entity";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { EventBus } from "../../events/event-bus";
import { applyInvitationProjectAccess } from "../../project-access/apply-invitation-project-access";
import { publishMemberProjects } from "../../project-access/publish-member-projects";
import { countMembers } from "../lookups/find-member";
import { findWorkspaceById } from "../lookups/find-workspace";
import type { OrganizationCaller } from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { invitationOutput } from "../output/invitation-output";
import { memberOutput } from "../output/member-output";

const MEMBERSHIP_LIMIT = 100;

function isRecipient(invitation: InvitationEntity, caller: OrganizationCaller) {
  return invitation.email.toLowerCase() === caller.user.email.toLowerCase();
}

/** The invitee's answer to an invitation addressed to them. */
@Injectable()
export class InvitationResponseService {
  private readonly logger = new Logger(InvitationResponseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
    private readonly events: EventBus,
  ) {}

  async accept(caller: OrganizationCaller, invitationId: string) {
    const manager = this.dataSource.manager;
    const invitation = await manager.findOne(InvitationEntity, {
      where: { id: invitationId },
    });
    if (
      !invitation ||
      invitation.expiresAt < new Date() ||
      invitation.status !== "pending"
    ) {
      throw organizationError(400, "INVITATION_NOT_FOUND");
    }
    if (!isRecipient(invitation, caller)) {
      throw organizationError(403, "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION");
    }
    const memberCount = await countMembers(manager, invitation.workspaceId);
    if (!(await findWorkspaceById(manager, invitation.workspaceId))) {
      throw organizationError(400, "ORGANIZATION_NOT_FOUND");
    }
    if (memberCount >= MEMBERSHIP_LIMIT) {
      throw organizationError(403, "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED");
    }

    await applyInvitationProjectAccess(manager, invitation, caller.user.id);

    // Claimed atomically, so two tabs accepting at once add one membership.
    const [accepted] = await updateReturning(
      manager,
      InvitationEntity,
      { status: "accepted" },
      { id: invitationId, status: "pending" },
    );
    if (!accepted) throw organizationError(400, "INVITATION_NOT_FOUND");

    const { member, teamIds } = await this.join(accepted, caller).catch(
      async (error: unknown) => {
        await updateReturning(
          manager,
          InvitationEntity,
          { status: "pending" },
          { id: invitationId },
        );
        throw error;
      },
    );

    if (caller.session) {
      if (teamIds.length === 1 && teamIds[0]) {
        await this.sessions.setActiveTeam(caller.session.id, teamIds[0]);
      }
      await this.sessions.setActiveOrganization(
        caller.session.id,
        accepted.workspaceId,
      );
    }

    await publishMemberProjects(
      manager,
      this.events,
      member.workspaceId,
      member.userId,
    ).catch((error: unknown) => {
      this.logger.error("Project member refresh failed:", error);
    });

    return { invitation: invitationOutput(accepted), member: memberOutput(member) };
  }

  async reject(caller: OrganizationCaller, invitationId: string) {
    const manager = this.dataSource.manager;
    const invitation = await manager.findOne(InvitationEntity, {
      where: { id: invitationId },
    });
    if (!invitation || invitation.status !== "pending") {
      throw organizationError(400, "INVITATION_NOT_FOUND", {
        message: "Invitation not found!",
      });
    }
    if (!isRecipient(invitation, caller)) {
      throw organizationError(403, "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION");
    }
    if (!(await findWorkspaceById(manager, invitation.workspaceId))) {
      throw organizationError(400, "ORGANIZATION_NOT_FOUND");
    }

    const [rejected] = await updateReturning(
      manager,
      InvitationEntity,
      { status: "rejected" },
      { id: invitationId },
    );
    return {
      invitation: rejected ? invitationOutput(rejected) : null,
      member: null,
    };
  }

  /** The membership, and the places in any teams the invitation names. */
  private join(invitation: InvitationEntity, caller: OrganizationCaller) {
    return this.dataSource.transaction(async (tx) => {
      const teamIds = invitation.teamId ? invitation.teamId.split(",") : [];
      for (const teamId of teamIds) {
        await this.joinTeam(tx, invitation.workspaceId, teamId, caller.user.id);
      }
      const member = await insertReturning(tx, WorkspaceUserEntity, {
        workspaceId: invitation.workspaceId,
        userId: caller.user.id,
        role: invitation.role ?? "member",
        joinedAt: new Date(),
      });
      if (!member) throw new Error("Failed to create membership");
      return { member, teamIds };
    });
  }

  private async joinTeam(
    tx: EntityManager,
    workspaceId: string,
    teamId: string,
    userId: string,
  ) {
    const team = await tx.findOne(TeamEntity, {
      where: { id: teamId, workspaceId },
    });
    if (!team) throw organizationError(400, "TEAM_NOT_FOUND");
    const existing = await tx.findOne(TeamMemberEntity, {
      where: { teamId, userId },
    });
    if (!existing) {
      await insertReturning(tx, TeamMemberEntity, {
        teamId,
        userId,
        createdAt: new Date(),
      });
    }
  }
}
