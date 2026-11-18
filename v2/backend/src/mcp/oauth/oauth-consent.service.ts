import { Injectable } from "@nestjs/common";
import { EventBus } from "../../events/event-bus";
import type { z } from "../../common/openapi";
import {
  authorizationRedirect,
  consentPageUrl,
} from "./consent-urls";
import { oauthError } from "./oauth-error";
import { McpOauthFlowState } from "./oauth-flow-state.service";
import type {
  authorizationQuerySchema,
  clientRegistrationSchema,
} from "./oauth.schemas";

type ClientRegistrationInput = z.infer<typeof clientRegistrationSchema>;
type AuthorizationInput = z.infer<typeof authorizationQuerySchema>;

/**
 * Dynamic client registration and the consent step: `/mcp/authorize` only
 * records the request and sends the browser to the web app, which shows
 * who is asking and posts the signed-in user's decision.
 */
@Injectable()
export class McpOauthConsent {
  constructor(
    private readonly flowState: McpOauthFlowState,
    private readonly events: EventBus,
  ) {}

  async registerClient(input: ClientRegistrationInput) {
    const client = await this.flowState.registerClient({
      redirectUris: input.redirect_uris,
      clientName: input.client_name,
    });

    return {
      client_id: client.clientId,
      client_id_issued_at: client.issuedAt,
      redirect_uris: client.redirectUris,
      client_name: client.clientName,
      token_endpoint_auth_method: "none" as const,
      grant_types: ["authorization_code" as const],
      response_types: ["code" as const],
    };
  }

  /** Returns the consent page URL the browser is redirected to. */
  async beginAuthorization(input: AuthorizationInput): Promise<string> {
    const client = await this.flowState.getClient(input.client_id);
    if (!client) throw oauthError(400, "invalid_client");
    if (!client.redirectUris.includes(input.redirect_uri)) {
      throw oauthError(400, "invalid_redirect_uri");
    }

    const requestId = await this.flowState.createAuthorizationRequest({
      clientId: input.client_id,
      codeChallenge: input.code_challenge,
      redirectUri: input.redirect_uri,
      state: input.state,
    });
    return consentPageUrl(requestId);
  }

  async getAuthorizationRequest(requestId: string) {
    const request = await this.flowState.getAuthorizationRequest(requestId);
    if (!request) throw oauthError(404, "invalid_or_expired_request");

    const client = await this.flowState.getClient(request.clientId);
    if (!client) throw oauthError(400, "invalid_client");

    return {
      client_name: client.clientName ?? "MCP client",
      redirect_uri: request.redirectUri,
    };
  }

  /** Returns where to send the browser: back to the client with a code or an error. */
  async decide(params: {
    requestId: string;
    approved: boolean;
    userId: string;
  }): Promise<string> {
    const request = await this.flowState.getAuthorizationRequest(
      params.requestId,
    );
    if (!request) throw oauthError(404, "invalid_or_expired_request");

    const client = await this.flowState.getClient(request.clientId);
    if (!client?.redirectUris.includes(request.redirectUri)) {
      throw oauthError(400, "invalid_client");
    }

    if (!params.approved) {
      if (!(await this.flowState.consumeAuthorizationRequest(params.requestId)))
        throw oauthError(404, "invalid_or_expired_request");
      return authorizationRedirect(request, { error: "access_denied" });
    }

    const code = await this.flowState.createAuthCode(
      {
        clientId: request.clientId,
        userId: params.userId,
        codeChallenge: request.codeChallenge,
        redirectUri: request.redirectUri,
      },
      params.requestId,
    );
    await this.events.publish("mcp.authorization_code_issued", {
      clientId: request.clientId,
      userId: params.userId,
      redirectUri: request.redirectUri,
    });
    return authorizationRedirect(request, { code });
  }
}
