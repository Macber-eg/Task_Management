import { Controller } from "@nestjs/common";
import { CurrentPrincipal } from "../../auth/current-user.decorator";
import type { Principal } from "../../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { OrganizationCallerService } from "../organization-caller.service";
import {
  createRoleRoute,
  deleteRoleRoute,
  getRoleRoute,
  hasPermissionRoute,
  listRolesRoute,
  updateRoleRoute,
} from "./role.routes";
import { RoleCreationService } from "./role-creation.service";
import { RoleDeletionService } from "./role-deletion.service";
import { RoleQueryService } from "./role-query.service";
import { RoleUpdateService } from "./role-update.service";

@Controller("auth/organization")
export class RoleController {
  constructor(
    private readonly callers: OrganizationCallerService,
    private readonly queries: RoleQueryService,
    private readonly creation: RoleCreationService,
    private readonly updates: RoleUpdateService,
    private readonly deletion: RoleDeletionService,
  ) {}

  @ApiRoute(hasPermissionRoute)
  async hasPermission(
    @Input() input: RouteInput<typeof hasPermissionRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const body = input.json;
    return this.queries.hasPermission(
      await this.callers.resolve(principal),
      body.organizationId,
      "permissions" in body ? body.permissions : undefined,
    );
  }

  @ApiRoute(createRoleRoute)
  async createRole(
    @Input() input: RouteInput<typeof createRoleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.creation.create(await this.callers.resolve(principal), input.json);
  }

  @ApiRoute(updateRoleRoute)
  async updateRole(
    @Input() input: RouteInput<typeof updateRoleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.updates.update(await this.callers.resolve(principal), input.json);
  }

  @ApiRoute(deleteRoleRoute)
  async deleteRole(
    @Input() input: RouteInput<typeof deleteRoleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.deletion.delete(await this.callers.resolve(principal), input.json);
  }

  @ApiRoute(listRolesRoute)
  async listRoles(
    @Input() input: RouteInput<typeof listRolesRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.queries.list(
      await this.callers.resolve(principal),
      input.query.organizationId,
    );
  }

  @ApiRoute(getRoleRoute)
  async getRole(
    @Input() input: RouteInput<typeof getRoleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.queries.get(await this.callers.resolve(principal), input.query);
  }
}
