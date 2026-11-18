import { Controller, Post, Req, UseFilters } from "@nestjs/common";
import type { Request } from "express";
import { Authenticator } from "../../auth/authenticator";
import { Public } from "../../auth/public.decorator";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { rawBodyText } from "./bounded-raw-body";
import { McpCodeExchange } from "./code-exchange.service";
import { isTrustedConsentOrigin } from "./consent-urls";
import { McpOauthConsent } from "./oauth-consent.service";
import { oauthError } from "./oauth-error";
import { OauthValidationFilter } from "./oauth-validation.filter";
import {
  authorizeRoute,
  decideAuthorizationRequestRoute,
  getAuthorizationRequestRoute,
  registerRoute,
} from "./oauth.routes";
import { parseTokenRequest } from "./token-request";

/**
 * OAuth 2.1 for the hosted MCP endpoint: dynamic registration of public
 * clients, PKCE (S256) and an explicit consent step in the web app. These
 * routes authenticate for themselves: only the consent decision needs a
 * signed-in user.
 */
@Public()
@Controller("mcp")
export class McpOauthController {
  constructor(
    private readonly consent: McpOauthConsent,
    private readonly codes: McpCodeExchange,
    private readonly authenticator: Authenticator,
  ) {}

  @ApiRoute(registerRoute)
  @UseFilters(new OauthValidationFilter("invalid_client_metadata"))
  register(@Input() input: RouteInput<typeof registerRoute>) {
    return this.consent.registerClient(input.json);
  }

  @ApiRoute(authorizeRoute)
  @UseFilters(new OauthValidationFilter("invalid_request"))
  async authorize(@Input() input: RouteInput<typeof authorizeRoute>) {
    const location = await this.consent.beginAuthorization(input.query);
    return reply(302, undefined, { Location: location });
  }

  @ApiRoute(getAuthorizationRequestRoute)
  @UseFilters(new OauthValidationFilter("invalid_request"))
  getAuthorizationRequest(
    @Input() input: RouteInput<typeof getAuthorizationRequestRoute>,
  ) {
    return this.consent.getAuthorizationRequest(input.param.requestId);
  }

  @ApiRoute(decideAuthorizationRequestRoute)
  @UseFilters(new OauthValidationFilter("invalid_request"))
  async decideAuthorizationRequest(
    @Input() input: RouteInput<typeof decideAuthorizationRequestRoute>,
    @Req() request: Request,
  ) {
    if (!isTrustedConsentOrigin(request.get("origin"))) {
      throw oauthError(403, "invalid_origin");
    }
    const userId = await this.signedInUserId(request);
    if (!userId) throw oauthError(401, "unauthorized");

    const redirect = await this.consent.decide({
      requestId: input.param.requestId,
      approved: input.json.approved,
      userId,
    });
    return { redirect };
  }

  @Post("token")
  async token(@Req() request: Request) {
    const parsed = parseTokenRequest(
      request.get("content-type") || "",
      rawBodyText(request),
    );
    if (!parsed.ok) return reply(400, { error: parsed.error });

    const { code, client_id, code_verifier, redirect_uri } = parsed.request;
    const result = await this.codes.exchange(
      code,
      client_id,
      code_verifier,
      redirect_uri,
    );
    if (!result) return reply(400, { error: "invalid_grant" });

    return reply(200, {
      access_token: result.accessToken,
      token_type: "bearer",
      expires_in: result.expiresIn,
    });
  }

  /** Consent is the person's own decision: a browser login, not an API key or MCP token. */
  private async signedInUserId(request: Request): Promise<string | null> {
    const principal = await this.authenticator
      .authenticate(request)
      .catch(() => null);
    if (!principal?.user || !principal.session || principal.apiKey) return null;
    return principal.session.kind === "browser" ? principal.user.id : null;
  }
}
