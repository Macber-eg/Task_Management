import { Controller, Req } from "@nestjs/common";
import { Access } from "../../../access/access-rule";
import { requireWorkspacePermission } from "../../../access/require-workspace-permission";
import { workspaceAccess } from "../../../access/workspace-access";
import { WorkspacePermissionService } from "../../../access/workspace-permission.service";
import type { ApiRequest } from "../../../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../../../common/openapi";
import { jsonOrNull } from "../../chat/shared/json-or-null";
import { scopeToProjectFromBody } from "../../core/scope-to-project-from-body";
import { tokenTypeOf } from "../config";
import { GitlabImportService } from "../import/gitlab-import.service";
import { GitlabIntegrationService } from "./gitlab-integration.service";
import {
  createGitlabIntegrationRoute,
  deleteGitlabIntegrationRoute,
  getGitlabIntegrationRoute,
  importGitlabIssuesRoute,
  listGitlabProjectsRoute,
  updateGitlabIntegrationRoute,
  verifyGitlabRoute,
} from "./gitlab-integration.routes";
import { listGitlabProjects } from "./list-gitlab-projects";
import { verifyGitlabAccess } from "./verify-gitlab-access";

const manageAccess = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ workspace: ["manage_settings"] }),
] as const;

@Controller("gitlab-integration")
export class GitlabIntegrationController {
  constructor(
    private readonly integrations: GitlabIntegrationService,
    private readonly imports: GitlabImportService,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  @ApiRoute(listGitlabProjectsRoute)
  @Access(...manageAccess)
  listProjects(@Input() input: RouteInput<typeof listGitlabProjectsRoute>) {
    const { baseUrl, accessToken, tokenType } = input.json;
    return listGitlabProjects({
      baseUrl,
      accessToken,
      tokenType: tokenTypeOf({ tokenType }),
    });
  }

  @ApiRoute(verifyGitlabRoute)
  @Access(...manageAccess)
  verify(@Input() input: RouteInput<typeof verifyGitlabRoute>) {
    const body = input.json;
    return verifyGitlabAccess({ ...body, tokenType: tokenTypeOf(body) });
  }

  @ApiRoute(getGitlabIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  async get(
    @Input() input: RouteInput<typeof getGitlabIntegrationRoute>,
    @Req() request: ApiRequest,
  ) {
    const includeSecrets = await this.permissions.hasWorkspacePermission(
      request,
      { workspace: ["manage_settings"] },
    );
    return jsonOrNull(
      this.integrations.get(input.param.projectId, includeSecrets),
    );
  }

  @ApiRoute(createGitlabIntegrationRoute)
  @Access(...manageAccess)
  create(@Input() input: RouteInput<typeof createGitlabIntegrationRoute>) {
    const body = input.json;
    return this.integrations.create({
      projectId: input.param.projectId,
      baseUrl: body.baseUrl,
      accessToken: body.accessToken,
      tokenType: tokenTypeOf(body),
      projectPath: body.projectPath,
    });
  }

  @ApiRoute(updateGitlabIntegrationRoute)
  @Access(...manageAccess)
  update(@Input() input: RouteInput<typeof updateGitlabIntegrationRoute>) {
    return this.integrations.update(input.param.projectId, input.json);
  }

  @ApiRoute(deleteGitlabIntegrationRoute)
  @Access(...manageAccess)
  delete(@Input() input: RouteInput<typeof deleteGitlabIntegrationRoute>) {
    return this.integrations.delete(input.param.projectId);
  }

  @ApiRoute(importGitlabIssuesRoute)
  @Access(
    scopeToProjectFromBody(),
    requireWorkspacePermission({ task: ["create", "update"] }),
  )
  importIssues(@Input() input: RouteInput<typeof importGitlabIssuesRoute>) {
    return this.imports.importIssues(input.json.projectId);
  }
}
