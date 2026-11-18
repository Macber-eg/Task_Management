import { Controller } from "@nestjs/common";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { CurrentPrincipal, UserId } from "../current-user.decorator";
import type { Principal } from "../principal";
import {
  createApiKeyRoute,
  deleteApiKeyRoute,
  getApiKeyRoute,
  listApiKeysRoute,
  updateApiKeyRoute,
} from "./api-key.routes";
import { ApiKeyCreationService } from "./api-key-creation.service";
import { ApiKeyDeletionService } from "./api-key-deletion.service";
import { ApiKeyQueryService } from "./api-key-query.service";
import { ApiKeyUpdateService } from "./api-key-update.service";

// A caller authenticated by an API key manages its owner's keys exactly as
// the owner's session does: the previous backend drew no line between them.
@Controller("auth/api-key")
export class ApiKeyController {
  constructor(
    private readonly creation: ApiKeyCreationService,
    private readonly query: ApiKeyQueryService,
    private readonly update: ApiKeyUpdateService,
    private readonly deletion: ApiKeyDeletionService,
  ) {}

  @ApiRoute(createApiKeyRoute)
  createApiKey(
    @Input() input: RouteInput<typeof createApiKeyRoute>,
    @UserId() userId: string,
  ) {
    return this.creation.createApiKey(userId, input.json);
  }

  @ApiRoute(listApiKeysRoute)
  listApiKeys(
    @Input() input: RouteInput<typeof listApiKeysRoute>,
    @UserId() userId: string,
  ) {
    return this.query.listApiKeys(userId, input.query);
  }

  @ApiRoute(deleteApiKeyRoute)
  deleteApiKey(
    @Input() input: RouteInput<typeof deleteApiKeyRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.deletion.deleteApiKey(principal, input.json.keyId);
  }

  @ApiRoute(getApiKeyRoute)
  getApiKey(
    @Input() input: RouteInput<typeof getApiKeyRoute>,
    @UserId() userId: string,
  ) {
    return this.query.getApiKey(userId, input.query.id);
  }

  @ApiRoute(updateApiKeyRoute)
  updateApiKey(
    @Input() input: RouteInput<typeof updateApiKeyRoute>,
    @UserId() userId: string,
  ) {
    return this.update.updateApiKey(userId, input.json);
  }
}
