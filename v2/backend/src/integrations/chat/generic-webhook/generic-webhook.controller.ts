import { Controller } from "@nestjs/common";
import { Access } from "../../../access/access-rule";
import { requireWorkspacePermission } from "../../../access/require-workspace-permission";
import { workspaceAccess } from "../../../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../../../common/openapi";
import { jsonOrNull } from "../shared/json-or-null";
import { GenericWebhookIntegrationService } from "./generic-webhook-integration.service";
import {
  createGenericWebhookIntegrationRoute,
  deleteGenericWebhookIntegrationRoute,
  getGenericWebhookIntegrationRoute,
  updateGenericWebhookIntegrationRoute,
} from "./generic-webhook.routes";

@Controller("generic-webhook-integration")
export class GenericWebhookController {
  constructor(private readonly integrations: GenericWebhookIntegrationService) {}

  @ApiRoute(getGenericWebhookIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  get(@Input() input: RouteInput<typeof getGenericWebhookIntegrationRoute>) {
    return jsonOrNull(this.integrations.get(input.param.projectId));
  }

  @ApiRoute(createGenericWebhookIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  create(@Input() input: RouteInput<typeof createGenericWebhookIntegrationRoute>) {
    return jsonOrNull(this.integrations.create(input.param.projectId, input.json));
  }

  @ApiRoute(updateGenericWebhookIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  update(@Input() input: RouteInput<typeof updateGenericWebhookIntegrationRoute>) {
    return jsonOrNull(this.integrations.update(input.param.projectId, input.json));
  }

  @ApiRoute(deleteGenericWebhookIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  delete(@Input() input: RouteInput<typeof deleteGenericWebhookIntegrationRoute>) {
    return this.integrations.delete(input.param.projectId);
  }
}
