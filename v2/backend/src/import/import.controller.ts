import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { UserId } from "../auth/current-user.decorator";
import { reply } from "../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { trelloAuthorizeUrl } from "../importers";
import { requireEntitlement } from "../project/entitlements/require-entitlement";
import { ResolvedWorkspaceId } from "../project/resolved-workspace-id.decorator";
import { ImportRunQueryService } from "./import-run-query.service";
import { ImportRunStartService } from "./import-run-start.service";
import {
  getImportRunRoute,
  getTrelloAuthorizeUrlRoute,
  listImportRunsRoute,
  listImportSourceProjectsRoute,
  startImportRunRoute,
} from "./import.routes";
import { ImportSourceProjectsService } from "./import-source-projects.service";
import { trelloApiKeyFromEnv } from "./source/trello-api-key";

const importPermission = requireWorkspacePermission({
  workspace: ["manage_settings"],
  project: ["create"],
});

// Declared in the previous router's order.
@Controller("import")
export class ImportController {
  constructor(
    private readonly sourceProjects: ImportSourceProjectsService,
    private readonly start: ImportRunStartService,
    private readonly runs: ImportRunQueryService,
  ) {}

  @ApiRoute(listImportSourceProjectsRoute)
  @Access(workspaceAccess.fromBody(), importPermission, requireEntitlement)
  listImportSourceProjects(
    @Input() input: RouteInput<typeof listImportSourceProjectsRoute>,
  ) {
    return this.sourceProjects.listSourceProjects(input.json.connection);
  }

  @ApiRoute(startImportRunRoute)
  @Access(workspaceAccess.fromBody(), importPermission, requireEntitlement)
  async startImportRun(
    @Input() input: RouteInput<typeof startImportRunRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
    @UserId() userId: string,
  ) {
    const { connection, projectIds, includeComments } = input.json;
    const run = await this.start.startImportRun({
      workspaceId,
      userId,
      connection,
      projectIds,
      includeComments,
    });
    return reply(202, { run });
  }

  @ApiRoute(listImportRunsRoute)
  @Access(workspaceAccess.fromParam("workspaceId"), importPermission)
  listImportRuns(@ResolvedWorkspaceId() workspaceId: string) {
    return this.runs.listImportRuns(workspaceId);
  }

  @ApiRoute(getTrelloAuthorizeUrlRoute)
  @Access(workspaceAccess.fromParam("workspaceId"), importPermission)
  getTrelloAuthorizeUrl() {
    const apiKey = trelloApiKeyFromEnv();
    return { authorizeUrl: apiKey ? trelloAuthorizeUrl(apiKey) : null };
  }

  @ApiRoute(getImportRunRoute)
  @Access(workspaceAccess.fromParam("workspaceId"), importPermission)
  getImportRun(
    @Input() input: RouteInput<typeof getImportRunRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    return this.runs.getImportRun(workspaceId, input.param.runId);
  }
}
