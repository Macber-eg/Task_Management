import { Controller } from "@nestjs/common";
import { CurrentPrincipal } from "../../auth/current-user.decorator";
import type { Principal } from "../../auth/principal";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { OrganizationCallerService } from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { ActiveOrganizationService } from "./active-organization.service";
import { OrganizationQueryService } from "./organization-query.service";
import {
  checkSlugRoute,
  createOrganizationRoute,
  deleteOrganizationRoute,
  getFullOrganizationRoute,
  listOrganizationsRoute,
  setActiveOrganizationRoute,
  updateOrganizationRoute,
} from "./workspace.routes";
import { WorkspaceCreationService } from "./workspace-creation.service";
import { WorkspaceDeletionService } from "./workspace-deletion.service";
import { WorkspaceUpdateService } from "./workspace-update.service";

@Controller("auth/organization")
export class WorkspaceController {
  constructor(
    private readonly callers: OrganizationCallerService,
    private readonly creation: WorkspaceCreationService,
    private readonly updates: WorkspaceUpdateService,
    private readonly deletion: WorkspaceDeletionService,
    private readonly queries: OrganizationQueryService,
    private readonly active: ActiveOrganizationService,
  ) {}

  @ApiRoute(createOrganizationRoute)
  async create(
    @Input() input: RouteInput<typeof createOrganizationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { userId: _userId, ...body } = input.json;
    return this.creation.create(await this.callers.resolve(principal), body);
  }

  @ApiRoute(checkSlugRoute)
  async checkSlug(@Input() input: RouteInput<typeof checkSlugRoute>) {
    if (await this.queries.isSlugTaken(input.json.slug)) {
      throw organizationError(400, "ORGANIZATION_SLUG_ALREADY_TAKEN");
    }
    return { status: true };
  }

  @ApiRoute(updateOrganizationRoute)
  async update(
    @Input() input: RouteInput<typeof updateOrganizationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const updated = await this.updates.update(
      await this.callers.resolve(principal),
      input.json.organizationId,
      input.json.data,
    );
    return updated ?? reply(200, null);
  }

  @ApiRoute(deleteOrganizationRoute)
  async delete(
    @Input() input: RouteInput<typeof deleteOrganizationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.deletion.delete(
      await this.callers.resolve(principal),
      input.json.organizationId,
    );
  }

  @ApiRoute(listOrganizationsRoute)
  list(@CurrentPrincipal() principal: Principal) {
    return this.queries.list(principal.userId);
  }

  @ApiRoute(getFullOrganizationRoute)
  async getFullOrganization(
    @Input() input: RouteInput<typeof getFullOrganizationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const organization = await this.queries.fullOrganization(
      await this.callers.resolve(principal),
      input.query,
    );
    return organization ?? reply(200, null);
  }

  @ApiRoute(setActiveOrganizationRoute)
  async setActive(
    @Input() input: RouteInput<typeof setActiveOrganizationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const organization = await this.active.setActive(
      await this.callers.resolve(principal),
      input.json,
    );
    return organization ?? reply(200, null);
  }
}
