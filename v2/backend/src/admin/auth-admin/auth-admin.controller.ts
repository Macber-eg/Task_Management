import { Controller, Req } from "@nestjs/common";
import type { Request } from "express";
import { CurrentPrincipal } from "../../auth/current-user.decorator";
import type { Principal } from "../../auth/principal";
import { Public } from "../../auth/public.decorator";
import { HTTPException } from "../../common/errors/http-exception";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { AdminBanService } from "./admin-ban.service";
import { hasAdminPermission } from "./admin-permission";
import { AdminUserRemovalService } from "./admin-user-removal.service";
import { AdminUserUpdateService } from "./admin-user-update.service";
import {
  banUserRoute,
  hasPermissionRoute,
  removeUserRoute,
  setRoleRoute,
  unbanUserRoute,
  updateUserRoute,
} from "./auth-admin.routes";
import { requireAdminLogin } from "./require-admin-login";

/**
 * The instance-admin endpoints under /api/auth/admin, with the paths,
 * bodies and errors of the auth library the previous backend used.
 */
@Controller("auth/admin")
export class AuthAdminController {
  constructor(
    private readonly updates: AdminUserUpdateService,
    private readonly bans: AdminBanService,
    private readonly removal: AdminUserRemovalService,
  ) {}

  @ApiRoute(hasPermissionRoute)
  hasPermission(
    @Input() input: RouteInput<typeof hasPermissionRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { permissions } = input.json;
    if (!permissions) {
      throw new HTTPException(400, {
        message: "invalid permission check. no permission(s) were passed.",
      });
    }
    const { user } = requireAdminLogin(principal);
    return { error: null, success: hasAdminPermission(user.role, permissions) };
  }

  @ApiRoute(updateUserRoute)
  updateUser(
    @Input() input: RouteInput<typeof updateUserRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.updates.updateUser(requireAdminLogin(principal), input.json);
  }

  @ApiRoute(setRoleRoute)
  setRole(
    @Input() input: RouteInput<typeof setRoleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.updates.setRole(requireAdminLogin(principal), input.json);
  }

  @ApiRoute(banUserRoute)
  banUser(
    @Input() input: RouteInput<typeof banUserRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.bans.ban(requireAdminLogin(principal), input.json);
  }

  @ApiRoute(unbanUserRoute)
  unbanUser(
    @Input() input: RouteInput<typeof unbanUserRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.bans.unban(requireAdminLogin(principal), input.json);
  }

  // Public: a caller who is not an instance admin, signed in or not, gets the
  // same 403 before anything else is looked at.
  @Public()
  @ApiRoute(removeUserRoute)
  removeUser(
    @Input() input: RouteInput<typeof removeUserRoute>,
    @Req() request: Request,
  ) {
    return this.removal.removeUser(request, input.json);
  }
}
