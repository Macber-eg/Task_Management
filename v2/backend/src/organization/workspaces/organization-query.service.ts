import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { SessionService } from "../../auth/sessions/session.service";
import { InvitationEntity } from "../../database/entities/invitation.entity";
import { TeamEntity } from "../../database/entities/team.entity";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { hideInaccessibleInvitationProjects } from "../invitations/hide-inaccessible-invitation-projects";
import { findMember } from "../lookups/find-member";
import {
  findWorkspaceById,
  findWorkspaceBySlug,
} from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { invitationOutput } from "../output/invitation-output";
import { memberWithUserOutput } from "../output/member-output";
import { teamOutput } from "../output/team-output";
import { workspaceOutput } from "../output/workspace-output";

// The previous backend read at most this many rows of any list.
const LIST_LIMIT = 100;

export type FullOrganizationQuery = {
  organizationId?: string;
  organizationSlug?: string;
  membersLimit?: number;
};

@Injectable()
export class OrganizationQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  async list(userId: string) {
    const memberships = await this.dataSource.manager.find(
      WorkspaceUserEntity,
      { where: { userId }, relations: { workspace: true }, take: LIST_LIMIT },
    );
    return memberships.flatMap((membership) =>
      membership.workspace ? [workspaceOutput(membership.workspace)] : [],
    );
  }

  async isSlugTaken(slug: string): Promise<boolean> {
    return !!(await findWorkspaceBySlug(this.dataSource.manager, slug));
  }

  /** The workspace with its members, invitations and teams, or null without one to show. */
  async fullOrganization(
    caller: OrganizationCaller,
    query: FullOrganizationQuery,
  ) {
    const manager = this.dataSource.manager;
    const key =
      query.organizationSlug ||
      query.organizationId ||
      activeOrganizationOf(caller);
    if (!key) return null;

    const workspace = query.organizationSlug
      ? await findWorkspaceBySlug(manager, key)
      : await findWorkspaceById(manager, key);
    if (!workspace) throw organizationError(400, "ORGANIZATION_NOT_FOUND");

    if (!(await findMember(manager, caller.user.id, workspace.id))) {
      if (caller.session) {
        await this.sessions.setActiveOrganization(caller.session.id, null);
      }
      throw organizationError(403, "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION");
    }

    const membersLimit =
      query.membersLimit && query.membersLimit > 0
        ? query.membersLimit
        : LIST_LIMIT;
    const [members, invitations, teams] = await Promise.all([
      manager.find(WorkspaceUserEntity, {
        where: { workspaceId: workspace.id },
        relations: { user: true },
        take: membersLimit,
      }),
      manager.find(InvitationEntity, {
        where: { workspaceId: workspace.id },
        take: LIST_LIMIT,
      }),
      manager.find(TeamEntity, {
        where: { workspaceId: workspace.id },
        take: LIST_LIMIT,
      }),
    ]);

    return {
      ...workspaceOutput(workspace),
      invitations: await hideInaccessibleInvitationProjects(
        manager,
        caller.user.id,
        invitations.map(invitationOutput),
      ),
      members: members.flatMap(({ user, ...member }) =>
        user ? [memberWithUserOutput(member, user)] : [],
      ),
      teams: teams.map(teamOutput),
    };
  }
}
