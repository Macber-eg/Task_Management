import { Controller, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { validationError } from "../../common/errors/validation-error";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { Authenticator } from "../authenticator";
import type { Principal } from "../principal";
import { Public } from "../public.decorator";
import { DeviceApprovalService } from "./device-approval.service";
import { DeviceCodeService } from "./device-code.service";
import { DEVICE_MESSAGES, deviceError } from "./device-error";
import { DeviceTokenService } from "./device-token.service";
import { deviceVerificationUri } from "./device-verification-uri";
import {
  deviceApproveRoute,
  deviceCodeRoute,
  deviceDenyRoute,
  deviceTokenRoute,
  deviceVerifyRoute,
} from "./device.routes";

const NO_STORE = { "Cache-Control": "no-store" };

const userCodeQuery = z.object({ user_code: z.string() });

/** The person behind a login session; API keys cannot approve devices. */
function sessionUserId(principal: Principal | null): string | null {
  return principal?.user && principal.session && !principal.apiKey
    ? principal.user.id
    : null;
}

/** Device authorization (RFC 8628) for the CLI and the MCP server. */
@Public()
@Controller("auth")
export class DeviceController {
  constructor(
    private readonly codes: DeviceCodeService,
    private readonly tokens: DeviceTokenService,
    private readonly approvals: DeviceApprovalService,
    private readonly authenticator: Authenticator,
  ) {}

  @ApiRoute(deviceCodeRoute)
  async requestCode(@Input() input: RouteInput<typeof deviceCodeRoute>) {
    return reply(200, await this.codes.request(input.json), NO_STORE);
  }

  @ApiRoute(deviceTokenRoute)
  async exchangeToken(
    @Input() input: RouteInput<typeof deviceTokenRoute>,
    @Req() request: Request,
  ) {
    const token = await this.tokens.exchange(input.json, {
      ipAddress: request.ip ?? null,
      userAgent: request.get("user-agent") ?? null,
    });
    return reply(200, token, { ...NO_STORE, Pragma: "no-cache" });
  }

  @ApiRoute(deviceVerifyRoute)
  async verify(
    @Input() input: RouteInput<typeof deviceVerifyRoute>,
    @Req() request: Request,
  ) {
    const { user_code: userCode, ui } = input.query;
    // Someone opening the API URL in a browser tab gets the web app's
    // device screen instead of JSON.
    if (ui === "1" || request.get("Sec-Fetch-Dest") === "document") {
      const target = new URL(deviceVerificationUri());
      if (userCode) target.searchParams.set("user_code", userCode);
      return reply(302, undefined, { Location: target.toString() });
    }

    const parsed = userCodeQuery.safeParse(input.query);
    if (!parsed.success) throw validationError(parsed.error.issues, "query");
    const principal = await this.authenticator
      .authenticate(request)
      .catch(() => null);
    return this.approvals.view(parsed.data.user_code, sessionUserId(principal));
  }

  @ApiRoute(deviceApproveRoute)
  async approve(
    @Input() input: RouteInput<typeof deviceApproveRoute>,
    @Req() request: Request,
  ) {
    const userId = await this.requireUserId(request);
    return this.approvals.decide(input.json.userCode, userId, "approved");
  }

  @ApiRoute(deviceDenyRoute)
  async deny(
    @Input() input: RouteInput<typeof deviceDenyRoute>,
    @Req() request: Request,
  ) {
    const userId = await this.requireUserId(request);
    return this.approvals.decide(input.json.userCode, userId, "denied");
  }

  private async requireUserId(request: Request): Promise<string> {
    const principal = await this.authenticator
      .authenticate(request)
      .catch(() => null);
    const userId = sessionUserId(principal);
    if (!userId) {
      throw deviceError(401, "unauthorized", DEVICE_MESSAGES.AUTHENTICATION_REQUIRED);
    }
    return userId;
  }
}
