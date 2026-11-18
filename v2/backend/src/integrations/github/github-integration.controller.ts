import { Controller, Inject } from "@nestjs/common";
import { Access } from "../../access/access-rule";
import { requireUserSession } from "../../access/require-user-session";
import { requireWorkspacePermission } from "../../access/require-workspace-permission";
import { workspaceAccess } from "../../access/workspace-access";
import { UserId } from "../../auth/current-user.decorator";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { jsonOrNull } from "../chat/shared/json-or-null";
import { scopeToProjectFromBody } from "../core/scope-to-project-from-body";
import { GITHUB_DEPS, type GitHubDeps } from "./github-deps";
import { GitHubIntegrationService } from "./github-integration.service";
import { GitHubImportService } from "./import/github-import.service";
import { listUserRepositories } from "./repositories/list-user-repositories";
import { verifyGithubInstallation } from "./repositories/verify-github-installation";
import { verifyRepositoryOwner } from "./repositories/verify-repository-owner";
import {
  createIntegrationRoute,
  deleteIntegrationRoute,
  getAppInfoRoute,
  getIntegrationRoute,
  importIssuesRoute,
  listRepositoriesRoute,
  updateIntegrationRoute,
  verifyRoute,
} from "./routes/github-integration.routes";

const manageAccess = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ workspace: ["manage_settings"] }),
];

@Controller("github-integration")
export class GitHubIntegrationController {
  constructor(
    @Inject(GITHUB_DEPS) private readonly deps: GitHubDeps,
    private readonly integrations: GitHubIntegrationService,
    private readonly imports: GitHubImportService,
  ) {}

  @ApiRoute(getAppInfoRoute)
  appInfo(@UserId() userId: string) {
    return this.integrations.appInfo(userId);
  }

  @ApiRoute(listRepositoriesRoute)
  @Access(requireUserSession(), ...manageAccess)
  listRepositories(
    @Input() input: RouteInput<typeof listRepositoriesRoute>,
    @UserId() userId: string,
  ) {
    return listUserRepositories(this.deps, userId, input.query);
  }

  @ApiRoute(verifyRoute)
  @Access(
    requireUserSession(),
    scopeToProjectFromBody(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  async verify(
    @Input() input: RouteInput<typeof verifyRoute>,
    @UserId() userId: string,
  ) {
    const { repositoryOwner, repositoryName } = input.json;
    await verifyRepositoryOwner(
      this.deps,
      userId,
      repositoryOwner,
      repositoryName,
    );
    return verifyGithubInstallation(this.deps.github, {
      repositoryOwner,
      repositoryName,
    });
  }

  @ApiRoute(getIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  get(@Input() input: RouteInput<typeof getIntegrationRoute>) {
    return jsonOrNull(this.integrations.get(input.param.projectId));
  }

  @ApiRoute(createIntegrationRoute)
  @Access(requireUserSession(), ...manageAccess)
  async create(
    @Input() input: RouteInput<typeof createIntegrationRoute>,
    @UserId() userId: string,
  ) {
    const { projectId } = input.param;
    const integration = await this.integrations.create({
      userId,
      projectId,
      ...input.json,
    });
    if (integration)
      await this.deps.events.publish("integration.sync_rules_changed", {
        projectId,
        integrationId: integration.id,
      });
    return integration;
  }

  @ApiRoute(updateIntegrationRoute)
  @Access(...manageAccess)
  update(@Input() input: RouteInput<typeof updateIntegrationRoute>) {
    return jsonOrNull(
      this.integrations.update(input.param.projectId, input.json),
    );
  }

  @ApiRoute(deleteIntegrationRoute)
  @Access(...manageAccess)
  delete(@Input() input: RouteInput<typeof deleteIntegrationRoute>) {
    return this.integrations.delete(input.param.projectId);
  }

  @ApiRoute(importIssuesRoute)
  @Access(
    scopeToProjectFromBody(),
    requireWorkspacePermission({ task: ["create", "update"] }),
  )
  async importIssues(@Input() input: RouteInput<typeof importIssuesRoute>) {
    const { projectId, runId } = input.json;
    const result = await this.imports.importIssues(projectId, runId);
    return result.pending ? reply(202, result) : result;
  }
}
