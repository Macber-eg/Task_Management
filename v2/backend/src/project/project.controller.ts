import { Controller, Req } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { WorkspacePermissionService } from "../access/workspace-permission.service";
import { CurrentPrincipal, UserId } from "../auth/current-user.decorator";
import type { ApiRequest, Principal } from "../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { requireEntitlement } from "./entitlements/require-entitlement";
import {
  archiveProjectRoute,
  createProjectRoute,
  deleteProjectRoute,
  getProjectRoute,
  listProjectsRoute,
  moveProjectRoute,
  reorderProjectsRoute,
  unarchiveProjectRoute,
  updateProjectRoute,
} from "./project.routes";
import { ProjectCreationService } from "./project-creation.service";
import { ProjectDeletionService } from "./project-deletion.service";
import { ProjectMoveAuthorization } from "./project-move-authorization";
import { ProjectMoveService } from "./project-move.service";
import { ProjectQueryService } from "./project-query.service";
import { ProjectReorderService } from "./project-reorder.service";
import { ProjectUpdateService } from "./project-update.service";
import { ResolvedWorkspaceId } from "./resolved-workspace-id.decorator";
import { toPublicProject } from "./to-public-project";

// Declared in the previous router's order: `PUT /reorder` must be registered
// before `PUT /:id`.
@Controller("project")
export class ProjectController {
  constructor(
    private readonly query: ProjectQueryService,
    private readonly creation: ProjectCreationService,
    private readonly reorder: ProjectReorderService,
    private readonly update: ProjectUpdateService,
    private readonly deletion: ProjectDeletionService,
    private readonly move: ProjectMoveService,
    private readonly moveAuthorization: ProjectMoveAuthorization,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  @ApiRoute(moveProjectRoute)
  @Access(
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update", "delete"] }),
  )
  async moveProject(
    @Input() input: RouteInput<typeof moveProjectRoute>,
    @Req() request: ApiRequest,
    @CurrentPrincipal() principal: Principal,
    @ResolvedWorkspaceId() sourceWorkspaceId: string,
  ) {
    const targetWorkspaceId = input.json.workspaceId;
    await this.moveAuthorization.authorizeDestination(
      request,
      principal,
      targetWorkspaceId,
    );
    return toPublicProject(
      await this.move.moveProject(
        input.param.id,
        sourceWorkspaceId,
        targetWorkspaceId,
        principal.userId,
      ),
    );
  }

  @ApiRoute(listProjectsRoute)
  @Access(workspaceAccess.fromQuery())
  async listProjects(
    @Input() input: RouteInput<typeof listProjectsRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
    @UserId() userId: string,
  ) {
    const projects = await this.query.getProjects(
      workspaceId,
      userId,
      input.query.includeArchived === "true",
    );
    return projects.map(toPublicProject);
  }

  @ApiRoute(createProjectRoute)
  @Access(
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ project: ["create"] }),
    requireEntitlement,
  )
  async createProject(
    @Input() input: RouteInput<typeof createProjectRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
    @UserId() userId: string,
  ) {
    const { name, icon, slug, startDate, endDate } = input.json;
    return toPublicProject(
      await this.creation.createProject({
        workspaceId,
        name,
        icon,
        slug,
        userId,
        startDate,
        endDate,
      }),
    );
  }

  @ApiRoute(getProjectRoute)
  @Access(workspaceAccess.fromProject())
  async getProject(
    @Input() input: RouteInput<typeof getProjectRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    return toPublicProject(
      await this.query.getProject(input.param.id, workspaceId),
    );
  }

  @ApiRoute(reorderProjectsRoute)
  @Access(
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ project: ["update"] }),
  )
  async reorderProjects(
    @Input() input: RouteInput<typeof reorderProjectsRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
    @UserId() userId: string,
  ) {
    const reordered = await this.reorder.reorderProjects(
      workspaceId,
      userId,
      input.json.projects,
    );
    return reordered.map(toPublicProject);
  }

  @ApiRoute(updateProjectRoute)
  @Access(
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  )
  async updateProject(
    @Input() input: RouteInput<typeof updateProjectRoute>,
    @Req() request: ApiRequest,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    return toPublicProject(
      await this.update.updateProject(
        input.param.id,
        workspaceId,
        input.json,
        await this.permissions.hasWorkspacePermission(request, {
          project: ["share"],
        }),
      ),
    );
  }

  @ApiRoute(deleteProjectRoute)
  @Access(
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["delete"] }),
  )
  async deleteProject(
    @Input() input: RouteInput<typeof deleteProjectRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    return toPublicProject(
      await this.deletion.deleteProject(input.param.id, workspaceId),
    );
  }

  @ApiRoute(archiveProjectRoute)
  @Access(
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  )
  async archiveProject(
    @Input() input: RouteInput<typeof archiveProjectRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    return toPublicProject(
      await this.update.archiveProject(input.param.id, workspaceId),
    );
  }

  @ApiRoute(unarchiveProjectRoute)
  @Access(
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  )
  async unarchiveProject(
    @Input() input: RouteInput<typeof unarchiveProjectRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    return toPublicProject(
      await this.update.unarchiveProject(input.param.id, workspaceId),
    );
  }
}
