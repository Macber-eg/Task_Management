import { Controller } from "@nestjs/common";
import { CurrentPrincipal } from "../auth/current-user.decorator";
import type { Principal } from "../auth/principal";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  deleteWorkspaceRuleRoute,
  getPreferencesRoute,
  updatePreferencesRoute,
  upsertWorkspaceRuleRoute,
} from "./notification-preferences.routes";
import { NotificationPreferencesQueryService } from "./notification-preferences-query.service";
import { NotificationPreferencesUpdateService } from "./notification-preferences-update.service";
import { WorkspaceRuleService } from "./workspace-rule.service";

// API keys carry no email address, so email delivery reads as unavailable.
const emailOf = (principal: Principal) => principal.userEmail || null;

@Controller("notification-preferences")
export class NotificationPreferencesController {
  constructor(
    private readonly query: NotificationPreferencesQueryService,
    private readonly update: NotificationPreferencesUpdateService,
    private readonly rules: WorkspaceRuleService,
  ) {}

  @ApiRoute(getPreferencesRoute)
  getPreferences(@CurrentPrincipal() principal: Principal) {
    return this.query.getNotificationPreferences(
      principal.userId,
      emailOf(principal),
    );
  }

  @ApiRoute(updatePreferencesRoute)
  updatePreferences(
    @Input() input: RouteInput<typeof updatePreferencesRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.update.updateNotificationPreferences(
      principal.userId,
      emailOf(principal),
      input.json,
    );
  }

  @ApiRoute(upsertWorkspaceRuleRoute)
  upsertWorkspaceRule(
    @Input() input: RouteInput<typeof upsertWorkspaceRuleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.rules.upsertWorkspaceRule(
      principal.userId,
      input.param.workspaceId,
      emailOf(principal),
      input.json,
    );
  }

  @ApiRoute(deleteWorkspaceRuleRoute)
  deleteWorkspaceRule(
    @Input() input: RouteInput<typeof deleteWorkspaceRuleRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.rules.deleteWorkspaceRule(
      principal.userId,
      input.param.workspaceId,
      emailOf(principal),
    );
  }
}
