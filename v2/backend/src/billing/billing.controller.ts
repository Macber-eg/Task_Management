import { Controller, Logger, Req } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireUserSession } from "../access/require-user-session";
import { WorkspaceMembershipService } from "../access/workspace-membership.service";
import { CurrentPrincipal, UserId } from "../auth/current-user.decorator";
import type { Principal } from "../auth/principal";
import { Public } from "../auth/public.decorator";
import { HTTPException } from "../common/errors/http-exception";
import type { RequestWithRawBody } from "../common/http/json-body-parser";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createCheckoutRoute,
  createPortalRoute,
  getWorkspaceBillingRoute,
  webhookRoute,
} from "./billing.routes";
import { creemWebhookSecret, isBillingEnabled } from "./billing-config";
import { BillingManagerService } from "./billing-manager.service";
import { BillingPortalService } from "./billing-portal.service";
import { CheckoutService } from "./checkout.service";
import { toWorkspaceBillingResponse } from "./to-workspace-billing-response";
import type { BillingWebhookEvent } from "./webhook/billing-webhook-event";
import { BillingWebhookService } from "./webhook/billing-webhook.service";
import { readRawBody } from "./webhook/read-raw-body";
import { verifyBillingWebhook } from "./webhook/verify-billing-webhook";
import { WorkspaceBillingService } from "./workspace-billing.service";

@Controller("billing")
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly membership: WorkspaceMembershipService,
    private readonly billing: WorkspaceBillingService,
    private readonly manager: BillingManagerService,
    private readonly checkout: CheckoutService,
    private readonly portal: BillingPortalService,
    private readonly webhooks: BillingWebhookService,
  ) {}

  // Public: authenticity comes from the provider's signature, not a session.
  @Public()
  @ApiRoute(webhookRoute)
  async handleWebhook(@Req() request: RequestWithRawBody) {
    if (!isBillingEnabled()) {
      throw new HTTPException(404, { message: "Not found" });
    }

    let event: BillingWebhookEvent;
    try {
      event = await verifyBillingWebhook(
        await readRawBody(request),
        request.headers,
        creemWebhookSecret(),
      );
    } catch (error) {
      this.logger.error("billing: webhook signature verification failed", error);
      throw new HTTPException(400, { message: "Invalid signature" });
    }

    return this.webhooks.handleWebhook(event);
  }

  @ApiRoute(getWorkspaceBillingRoute)
  async getWorkspaceBilling(
    @Input() input: RouteInput<typeof getWorkspaceBillingRoute>,
    @UserId() userId: string,
  ) {
    const { workspaceId } = input.param;
    await this.membership.validateWorkspaceAccess(userId, workspaceId);
    return toWorkspaceBillingResponse(
      await this.billing.getOrCreateWorkspaceBilling(workspaceId),
    );
  }

  @ApiRoute(createCheckoutRoute)
  @Access(requireUserSession())
  async createCheckout(
    @Input() input: RouteInput<typeof createCheckoutRoute>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { workspaceId } = input.param;
    const { plan, interval } = input.json;
    await this.manager.requireBillingManager(principal.userId, workspaceId);

    return this.checkout.createCheckout({
      workspaceId,
      plan,
      interval,
      userEmail: principal.userEmail ?? "",
    });
  }

  @ApiRoute(createPortalRoute)
  @Access(requireUserSession())
  async createPortal(
    @Input() input: RouteInput<typeof createPortalRoute>,
    @UserId() userId: string,
  ) {
    const { workspaceId } = input.param;
    await this.manager.requireBillingManager(userId, workspaceId);
    return this.portal.createPortalLink(workspaceId);
  }
}
