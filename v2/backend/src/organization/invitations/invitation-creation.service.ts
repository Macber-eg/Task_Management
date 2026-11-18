import { Injectable, Logger } from "@nestjs/common";
import { DataSource, MoreThan } from "typeorm";
import { authError } from "../../auth/auth-error";
import { ApiError } from "../../common/errors/api-error";
import { HTTPException } from "../../common/errors/http-exception";
import { z } from "../../common/openapi";
import { insertReturning, updateReturning } from "../../database/dml";
import { InvitationEntity } from "../../database/entities/invitation.entity";
import { TeamEntity } from "../../database/entities/team.entity";
import type { WorkspaceEntity } from "../../database/entities/workspace.entity";
import { ProjectAccessRequestService } from "../../project-access/project-access-request.service";
import { hasOwnerRole } from "../lookups/count-owners";
import { findMember, findMemberByEmail } from "../lookups/find-member";
import { findWorkspaceById } from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import {
  type InvitationOutput,
  invitationOutput,
} from "../output/invitation-output";
import { findUnknownRoles } from "../roles/find-unknown-roles";
import { OrganizationPermissionService } from "../roles/organization-permission.service";
import { CREATOR_ROLE } from "../roles/role-authorization";
import { InvitationMailer } from "./invitation-mailer";

const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1000;
const PENDING_INVITATION_LIMIT = 100;

export type InviteInput = {
  email: string;
  role: string | string[];
  organizationId?: string;
  resend?: boolean;
  teamId?: string | string[];
  projectAccess?: string | null;
  projectIds?: string[] | null;
};

@Injectable()
export class InvitationCreationService {
  private readonly logger = new Logger(InvitationCreationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: OrganizationPermissionService,
    private readonly projectAccess: ProjectAccessRequestService,
    private readonly mailer: InvitationMailer,
  ) {}

  /** Invites an address, or with `resend` renews and re-sends its pending invitation. */
  async invite(
    caller: OrganizationCaller,
    input: InviteInput,
  ): Promise<InvitationOutput> {
    const manager = this.dataSource.manager;
    const workspaceId = input.organizationId || activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "ORGANIZATION_NOT_FOUND");
    const email = input.email.toLowerCase();
    if (!z.email().safeParse(email).success) throw authError("INVALID_EMAIL");

    const inviter = await findMember(manager, caller.user.id, workspaceId);
    if (!inviter) throw organizationError(400, "MEMBER_NOT_FOUND");
    const allowed = await this.permissions.hasPermission({
      workspaceId,
      role: inviter.member.role,
      permissions: { invitation: ["create"] },
    });
    if (!allowed) {
      throw organizationError(
        403,
        "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
      );
    }

    const role = Array.isArray(input.role) ? input.role.join(",") : input.role;
    await this.assertRolesGrantable(workspaceId, inviter.member.role, role);

    if (await findMemberByEmail(manager, email, workspaceId)) {
      throw organizationError(400, "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION");
    }
    const [pending] = await manager.find(InvitationEntity, {
      where: {
        email,
        workspaceId,
        status: "pending",
        expiresAt: MoreThan(new Date()),
      },
      take: 1,
    });
    if (pending && !input.resend) {
      throw organizationError(400, "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION");
    }
    const workspace = await findWorkspaceById(manager, workspaceId);
    if (!workspace) throw organizationError(400, "ORGANIZATION_NOT_FOUND");

    if (pending) return this.resend(pending, workspace, caller);

    const pendingCount = await manager.count(InvitationEntity, {
      where: { workspaceId, status: "pending", expiresAt: MoreThan(new Date()) },
    });
    if (pendingCount >= PENDING_INVITATION_LIMIT) {
      throw organizationError(403, "INVITATION_LIMIT_REACHED");
    }

    const teamIds =
      typeof input.teamId === "string" ? [input.teamId] : (input.teamId ?? []);
    if (input.teamId) await this.assertTeams(workspaceId, teamIds);

    const access = await this.projectAccess.resolveProjectAccessRequest({
      workspaceId,
      actorId: caller.user.id,
      targetRole: role,
      projectAccess: input.projectAccess,
      projectIds: input.projectIds,
    });
    if (!access.ok) {
      throw new ApiError(access.status, {
        code: access.status === 400 ? "BAD_REQUEST" : "FORBIDDEN",
        message: access.message,
      });
    }

    const invitation = await insertReturning(manager, InvitationEntity, {
      workspaceId,
      email,
      role,
      teamId: teamIds.length > 0 ? teamIds.join(",") : null,
      status: "pending",
      expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
      createdAt: new Date(),
      inviterId: caller.user.id,
      projectAccess: access.access.projectAccess,
      projectIds: access.access.projectIds,
    });
    if (!invitation) throw new Error("Failed to create invitation");

    const output = invitationOutput(invitation);
    await this.send(output, workspace, caller);
    return output;
  }

  private async resend(
    pending: InvitationEntity,
    workspace: WorkspaceEntity,
    caller: OrganizationCaller,
  ): Promise<InvitationOutput> {
    const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
    await updateReturning(
      this.dataSource.manager,
      InvitationEntity,
      { expiresAt },
      { id: pending.id },
    );
    const output = { ...invitationOutput(pending), expiresAt };
    await this.send(output, workspace, caller);
    return output;
  }

  private async assertRolesGrantable(
    workspaceId: string,
    inviterRole: string,
    role: string,
  ): Promise<void> {
    const roles = role
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const unknown = await findUnknownRoles(
      this.dataSource.manager,
      workspaceId,
      roles,
    );
    // No code here: the previous backend sent only this message.
    if (unknown.length > 0) {
      throw new HTTPException(400, {
        message: `ROLE_NOT_FOUND: ${unknown.join(", ")}`,
      });
    }
    const inviterIsOwner = inviterRole
      .split(",")
      .map((name) => name.trim())
      .includes(CREATOR_ROLE);
    if (!inviterIsOwner && hasOwnerRole(role)) {
      throw organizationError(
        403,
        "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE",
      );
    }
  }

  private async assertTeams(workspaceId: string, teamIds: string[]) {
    if (teamIds.some((id) => id.includes(","))) {
      throw organizationError(400, "INVALID_TEAM_ID");
    }
    for (const id of teamIds) {
      const team = await this.dataSource.manager.findOne(TeamEntity, {
        where: { id, workspaceId },
      });
      if (!team) throw organizationError(400, "TEAM_NOT_FOUND");
    }
  }

  // The invitation stays saved when delivery fails; the caller is told so
  // it can resend.
  private async send(
    invitation: InvitationOutput,
    workspace: WorkspaceEntity,
    caller: OrganizationCaller,
  ): Promise<void> {
    try {
      await this.mailer.sendInvitation({
        invitation,
        workspace,
        inviter: caller.user,
      });
    } catch (error) {
      this.logger.error("Invitation email delivery failed", error);
      throw new ApiError(502, {
        code: "INVITATION_EMAIL_FAILED",
        message:
          "Invitation saved, but email delivery failed. Check SMTP settings and resend the invitation.",
      });
    }
  }
}
