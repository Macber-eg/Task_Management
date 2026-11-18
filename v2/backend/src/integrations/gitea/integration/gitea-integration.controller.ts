import { Controller, Req } from "@nestjs/common";
import { Access } from "../../../access/access-rule";
import { requireWorkspacePermission } from "../../../access/require-workspace-permission";
import { workspaceAccess } from "../../../access/workspace-access";
import { WorkspacePermissionService } from "../../../access/workspace-permission.service";
import type { ApiRequest } from "../../../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../../../common/openapi";
import { jsonOrNull } from "../../chat/shared/json-or-null";
import { scopeToProjectFromBody } from "../../core/scope-to-project-from-body";
import { GiteaImportService } from "../import/gitea-import.service";
import {
  createGiteaIntegrationRoute,
  deleteGiteaIntegrationRoute,
  getGiteaIntegrationRoute,
  importGiteaIssuesRoute,
  listGiteaRepositoriesRoute,
  updateGiteaIntegrationRoute,
  verifyGiteaRoute,
} from "./gitea-integration.routes";
import { GiteaIntegrationService } from "./gitea-integration.service";
import { listGiteaRepositories } from "./list-gitea-repositories";
import { verifyGiteaAccess } from "./verify-gitea-access";

const manageAccess = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ workspace: ["manage_settings"] }),
] as const;

@Controller("gitea-integration")
export class GiteaIntegrationController {
  constructor(
    private readonly integrations: GiteaIntegrationService,
    private readonly imports: GiteaImportService,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  @ApiRoute(listGiteaRepositoriesRoute)
  @Access(...manageAccess)
  listRepositories(
    @Input() input: RouteInput<typeof listGiteaRepositoriesRoute>,
  ) {
    const { baseUrl, accessToken } = input.json;
    return listGiteaRepositories({ baseUrl, accessToken });
  }

  @ApiRoute(verifyGiteaRoute)
  @Access(...manageAccess)
  async verify(@Input() input: RouteInput<typeof verifyGiteaRoute>) {
    const body = input.json;
    const accessToken = await this.integrations.resolveVerificationToken(body);
    return verifyGiteaAccess({ ...body, accessToken });
  }

  @ApiRoute(getGiteaIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  async get(
    @Input() input: RouteInput<typeof getGiteaIntegrationRoute>,
    @Req() request: ApiRequest,
  ) {
    const includeWebhookSecret =
      await this.permissions.hasWorkspacePermission(request, {
        workspace: ["manage_settings"],
      });
    return jsonOrNull(
      this.integrations.get(input.param.projectId, includeWebhookSecret),
    );
  }

  @ApiRoute(createGiteaIntegrationRoute)
  @Access(...manageAccess)
  create(@Input() input: RouteInput<typeof createGiteaIntegrationRoute>) {
    const body = input.json;
    return this.integrations.create({
      projectId: input.param.projectId,
      baseUrl: body.baseUrl,
      accessToken: body.accessToken,
      repositoryOwner: body.repositoryOwner,
      repositoryName: body.repositoryName,
    });
  }

  @ApiRoute(updateGiteaIntegrationRoute)
  @Access(...manageAccess)
  update(@Input() input: RouteInput<typeof updateGiteaIntegrationRoute>) {
    return this.integrations.update(input.param.projectId, input.json);
  }

  @ApiRoute(deleteGiteaIntegrationRoute)
  @Access(...manageAccess)
  delete(@Input() input: RouteInput<typeof deleteGiteaIntegrationRoute>) {
    return this.integrations.delete(input.param.projectId);
  }

  @ApiRoute(importGiteaIssuesRoute)
  @Access(
    scopeToProjectFromBody(),
    requireWorkspacePermission({ task: ["create", "update"] }),
  )
  importIssues(@Input() input: RouteInput<typeof importGiteaIssuesRoute>) {
    return this.imports.importIssues(input.json.projectId);
  }
}
