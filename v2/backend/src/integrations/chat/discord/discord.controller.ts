import { Controller } from "@nestjs/common";
import { Access } from "../../../access/access-rule";
import { requireWorkspacePermission } from "../../../access/require-workspace-permission";
import { workspaceAccess } from "../../../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../../../common/openapi";
import { jsonOrNull } from "../shared/json-or-null";
import { DiscordIntegrationService } from "./discord-integration.service";
import {
  createDiscordIntegrationRoute,
  deleteDiscordIntegrationRoute,
  getDiscordIntegrationRoute,
  updateDiscordIntegrationRoute,
} from "./discord.routes";

@Controller("discord-integration")
export class DiscordController {
  constructor(private readonly integrations: DiscordIntegrationService) {}

  @ApiRoute(getDiscordIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  get(@Input() input: RouteInput<typeof getDiscordIntegrationRoute>) {
    return jsonOrNull(this.integrations.get(input.param.projectId));
  }

  @ApiRoute(createDiscordIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  create(@Input() input: RouteInput<typeof createDiscordIntegrationRoute>) {
    return jsonOrNull(this.integrations.create(input.param.projectId, input.json));
  }

  @ApiRoute(updateDiscordIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  update(@Input() input: RouteInput<typeof updateDiscordIntegrationRoute>) {
    return jsonOrNull(this.integrations.update(input.param.projectId, input.json));
  }

  @ApiRoute(deleteDiscordIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  delete(@Input() input: RouteInput<typeof deleteDiscordIntegrationRoute>) {
    return this.integrations.delete(input.param.projectId);
  }
}
