import { Injectable, Logger } from "@nestjs/common";
import { DataSource, QueryFailedError } from "typeorm";
import { hasInstanceAdminRole } from "../../access/instance-admin-role";
import { SessionService } from "../../auth/sessions/session.service";
import { ApiError } from "../../common/errors/api-error";
import { insertReturning } from "../../database/dml";
import { TeamEntity } from "../../database/entities/team.entity";
import { TeamMemberEntity } from "../../database/entities/team-member.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { WorkspaceEntity } from "../../database/entities/workspace.entity";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { EventBus } from "../../events/event-bus";
import { WorkspaceMemberLifecycleService } from "../../workspace-members/workspace-member-lifecycle.service";
import { findWorkspaceBySlug } from "../lookups/find-workspace";
import type { OrganizationCaller } from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { memberOutput } from "../output/member-output";
import { writtenWorkspaceOutput } from "../output/workspace-output";
import { CREATOR_ROLE } from "../roles/role-authorization";
import { seedDefaultRoles } from "../roles/seed-default-roles";
import { checkWorkspaceName } from "./check-workspace-name";

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: Record<string, unknown>;
  description?: string | null;
  keepCurrentActiveOrganization?: boolean;
};

function isUniqueViolation(error: unknown) {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === "23505"
  );
}

@Injectable()
export class WorkspaceCreationService {
  private readonly logger = new Logger(WorkspaceCreationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly lifecycle: WorkspaceMemberLifecycleService,
    private readonly sessions: SessionService,
  ) {}

  async create(caller: OrganizationCaller, input: CreateWorkspaceInput) {
    const { user, session } = caller;
    if (!(await this.mayCreate(user.id))) {
      throw organizationError(
        403,
        "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
      );
    }
    if (await findWorkspaceBySlug(this.dataSource.manager, input.slug)) {
      throw organizationError(400, "ORGANIZATION_ALREADY_EXISTS");
    }
    const nameCheck = checkWorkspaceName(input.name);
    if (!nameCheck.ok) {
      throw new ApiError(400, {
        code: "INVALID_WORKSPACE_NAME",
        message: nameCheck.reason,
      });
    }

    const { workspace, member, team } = await this.insertRows(user, input);

    await this.lifecycle.handleMemberAdded(workspace.id, user.id);
    await seedDefaultRoles(this.dataSource.manager, [workspace.id]).catch(
      (error: unknown) => {
        this.logger.error(
          `Failed to seed default workspace roles for workspace ${workspace.id}`,
          error,
        );
      },
    );
    // `ownerEmail` has always carried the owner's name; subscribers rely on it.
    await this.events.publish("workspace.created", {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      ownerEmail: user.name,
      ownerId: user.id,
    });

    if (session && !input.keepCurrentActiveOrganization) {
      await this.sessions.setActiveOrganization(session.id, workspace.id);
      await this.sessions.setActiveTeam(session.id, team.id);
    }

    return {
      ...writtenWorkspaceOutput(workspace),
      members: [memberOutput(member)],
    };
  }

  // With DISABLE_WORKSPACE_CREATION only instance admins may create one. The
  // role is read fresh: the session's copy can predate a promotion.
  private async mayCreate(userId: string): Promise<boolean> {
    if (process.env.DISABLE_WORKSPACE_CREATION !== "true") return true;
    const user = await this.dataSource.manager.findOne(UserEntity, {
      where: { id: userId },
      select: { id: true, role: true },
    });
    return hasInstanceAdminRole(user?.role);
  }

  /** The workspace, its owner, and the default team the owner belongs to. */
  private async insertRows(user: UserEntity, input: CreateWorkspaceInput) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const workspace = await insertReturning(manager, WorkspaceEntity, {
          name: input.name,
          slug: input.slug,
          logo: input.logo ?? null,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          description: input.description ?? null,
          createdAt: new Date(),
        });
        if (!workspace) throw new Error("Failed to create workspace");

        const member = await insertReturning(manager, WorkspaceUserEntity, {
          workspaceId: workspace.id,
          userId: user.id,
          role: CREATOR_ROLE,
          joinedAt: new Date(),
        });
        const team = await insertReturning(manager, TeamEntity, {
          name: workspace.name,
          workspaceId: workspace.id,
          createdAt: new Date(),
        });
        if (!member || !team) throw new Error("Failed to create workspace");
        await insertReturning(manager, TeamMemberEntity, {
          teamId: team.id,
          userId: user.id,
          createdAt: new Date(),
        });
        return { workspace, member, team };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw organizationError(400, "ORGANIZATION_ALREADY_EXISTS");
      }
      throw error;
    }
  }
}
