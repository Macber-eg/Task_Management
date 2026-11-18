import { Controller } from "@nestjs/common";
import { Access } from "../../../access/access-rule";
import { requireWorkspacePermission } from "../../../access/require-workspace-permission";
import { workspaceAccess } from "../../../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../../../common/openapi";
import { jsonOrNull } from "../shared/json-or-null";
import { MattermostIntegrationService } from "./mattermost-integration.service";
import {
  createMattermostIntegrationRoute,
  deleteMattermostIntegrationRoute,
  getMattermostIntegrationRoute,
  updateMattermostIntegrationRoute,
} from "./mattermost.routes";

@Controller("mattermost-integration")
export class MattermostController {
  constructor(private readonly integrations: MattermostIntegrationService) {}

  @ApiRoute(getMattermostIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  get(@Input() input: RouteInput<typeof getMattermostIntegrationRoute>) {
    return jsonOrNull(this.integrations.get(input.param.projectId));
  }

  @ApiRoute(createMattermostIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  create(@Input() input: RouteInput<typeof createMattermostIntegrationRoute>) {
    return jsonOrNull(this.integrations.create(input.param.projectId, input.json));
  }

  @ApiRoute(updateMattermostIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  update(@Input() input: RouteInput<typeof updateMattermostIntegrationRoute>) {
    return jsonOrNull(this.integrations.update(input.param.projectId, input.json));
  }

  @ApiRoute(deleteMattermostIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  delete(@Input() input: RouteInput<typeof deleteMattermostIntegrationRoute>) {
    return this.integrations.delete(input.param.projectId);
  }
}
