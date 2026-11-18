import { Controller } from "@nestjs/common";
import { CurrentPrincipal } from "../../auth/current-user.decorator";
import type { Principal } from "../../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { OrganizationCallerService } from "../organization-caller.service";
import {
  getActiveMemberRoleRoute,
  getActiveMemberRoute,
  leaveOrganizationRoute,
  listMembersRoute,
  removeMemberRoute,
  updateMemberRoleRoute,
} from "./member.routes";
import { MemberQueryService } from "./member-query.service";
import { MemberRemovalService } from "./member-removal.service";
import { MemberRoleService } from "./member-role.service";

@Controller("auth/organization")
export class MemberController {
  constructor(
    private readonly callers: OrganizationCallerService,
    private readonly queries: MemberQueryService,
    private readonly roles: MemberRoleService,
    private readonly removal: MemberRemovalService,
  ) {}

  @ApiRoute(leaveOrganizationRoute)
  async leave(
    @Input() input: RouteInput<typeof leaveOrganizationRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.removal.leave(
      await this.callers.resolve(principal),
      input.json.organizationId,
    );
  }

  @ApiRoute(listMembersRoute)
  async listMembers(
    @Input() input: RouteInput<typeof listMembersRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const query = input.query;
    return this.queries.listMembers(
      await this.callers.resolve(principal),
      query,
      {
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
        sortBy: query.sortBy,
        sortDirection: query.sortDirection,
        filter: query.filterField
          ? {
              field: query.filterField,
              operator: query.filterOperator,
              value: query.filterValue,
            }
          : undefined,
      },
    );
  }

  @ApiRoute(getActiveMemberRoute)
  async getActiveMember(@CurrentPrincipal() principal: Principal) {
    return this.queries.activeMember(await this.callers.resolve(principal));
  }

  @ApiRoute(getActiveMemberRoleRoute)
  async getActiveMemberRole(
    @Input() input: RouteInput<typeof getActiveMemberRoleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.queries.memberRole(
      await this.callers.resolve(principal),
      input.query,
      input.query.userId,
    );
  }

  @ApiRoute(updateMemberRoleRoute)
  async updateMemberRole(
    @Input() input: RouteInput<typeof updateMemberRoleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.roles.updateRole(
      await this.callers.resolve(principal),
      input.json,
    );
  }

  @ApiRoute(removeMemberRoute)
  async removeMember(
    @Input() input: RouteInput<typeof removeMemberRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.removal.remove(
      await this.callers.resolve(principal),
      input.json.memberIdOrEmail,
      input.json.organizationId,
    );
  }
}
