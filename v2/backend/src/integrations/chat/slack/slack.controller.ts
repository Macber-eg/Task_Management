import { Controller } from "@nestjs/common";
import { Access } from "../../../access/access-rule";
import { requireWorkspacePermission } from "../../../access/require-workspace-permission";
import { workspaceAccess } from "../../../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../../../common/openapi";
import { jsonOrNull } from "../shared/json-or-null";
import { SlackIntegrationService } from "./slack-integration.service";
import {
  createSlackIntegrationRoute,
  deleteSlackIntegrationRoute,
  getSlackIntegrationRoute,
  updateSlackIntegrationRoute,
} from "./slack.routes";

@Controller("slack-integration")
export class SlackController {
  constructor(private readonly integrations: SlackIntegrationService) {}

  @ApiRoute(getSlackIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  get(@Input() input: RouteInput<typeof getSlackIntegrationRoute>) {
    return jsonOrNull(this.integrations.get(input.param.projectId));
  }

  @ApiRoute(createSlackIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  create(@Input() input: RouteInput<typeof createSlackIntegrationRoute>) {
    return jsonOrNull(this.integrations.create(input.param.projectId, input.json));
  }

  @ApiRoute(updateSlackIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  update(@Input() input: RouteInput<typeof updateSlackIntegrationRoute>) {
    return jsonOrNull(this.integrations.update(input.param.projectId, input.json));
  }

  @ApiRoute(deleteSlackIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  delete(@Input() input: RouteInput<typeof deleteSlackIntegrationRoute>) {
    return this.integrations.delete(input.param.projectId);
  }
}
