import { Module } from "@nestjs/common";
import { McpDiscoveryController } from "./discovery/discovery.controller";
import { McpCodeExchange } from "./oauth/code-exchange.service";
import { McpOauthConsent } from "./oauth/oauth-consent.service";
import { McpOauthFlowState } from "./oauth/oauth-flow-state.service";
import { McpOauthStore } from "./oauth/oauth-state.store";
import { McpOauthController } from "./oauth/oauth.controller";
import { McpBearerAuthenticator } from "./server/mcp-bearer.service";
import { McpEndpointController } from "./server/mcp-endpoint.controller";
import { McpEndpoint } from "./server/mcp-endpoint.service";

/**
 * The hosted MCP server (`/api/mcp`), its OAuth 2.1 authorization server
 * and discovery documents. Tools call the REST API over HTTP as the caller.
 */
@Module({
  controllers: [McpOauthController, McpEndpointController, McpDiscoveryController],
  providers: [
    McpOauthStore,
    McpOauthFlowState,
    McpOauthConsent,
    McpCodeExchange,
    McpBearerAuthenticator,
    McpEndpoint,
  ],
})
export class McpModule {}
