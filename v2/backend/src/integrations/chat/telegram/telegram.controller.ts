import { Controller } from "@nestjs/common";
import { Access } from "../../../access/access-rule";
import { requireWorkspacePermission } from "../../../access/require-workspace-permission";
import { workspaceAccess } from "../../../access/workspace-access";
import { CurrentPrincipal } from "../../../auth/current-user.decorator";
import type { Principal } from "../../../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../../../common/openapi";
import { jsonOrNull } from "../shared/json-or-null";
import {
  type TelegramActor,
  TelegramIntegrationService,
} from "./telegram-integration.service";
import {
  createTelegramIntegrationRoute,
  deleteTelegramIntegrationRoute,
  getTelegramIntegrationRoute,
  updateTelegramIntegrationRoute,
} from "./telegram.routes";

function actorOf(principal: Principal): TelegramActor {
  return { userId: principal.userId, apiKeyId: principal.apiKey?.id };
}

@Controller("telegram-integration")
export class TelegramController {
  constructor(private readonly integrations: TelegramIntegrationService) {}

  @ApiRoute(getTelegramIntegrationRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  get(@Input() input: RouteInput<typeof getTelegramIntegrationRoute>) {
    return jsonOrNull(this.integrations.get(input.param.projectId));
  }

  @ApiRoute(createTelegramIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  create(
    @Input() input: RouteInput<typeof createTelegramIntegrationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.integrations.create(
      input.param.projectId,
      input.json,
      actorOf(principal),
    );
  }

  @ApiRoute(updateTelegramIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  update(
    @Input() input: RouteInput<typeof updateTelegramIntegrationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.integrations.update(
      input.param.projectId,
      input.json,
      actorOf(principal),
    );
  }

  @ApiRoute(deleteTelegramIntegrationRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  )
  delete(
    @Input() input: RouteInput<typeof deleteTelegramIntegrationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.integrations.delete(input.param.projectId, actorOf(principal));
  }
}
