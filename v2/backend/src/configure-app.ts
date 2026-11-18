import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { boundedJsonBody } from "./common/http/bounded-json-body";
import { buildCorsOptions } from "./common/http/cors-options";
import { jsonBodyParser } from "./common/http/json-body-parser";
import { originCheck } from "./common/http/origin-check";
import { outsideApiNotFound } from "./common/http/outside-api-not-found";
import { trustedProxyMatcher } from "./common/http/trusted-proxies";
import { eventContextMiddleware } from "./events/event-context";
import { MCP_UNPREFIXED_ROUTES } from "./mcp/discovery/discovery-routes";
import { mcpOauthRequestBounds } from "./mcp/oauth/request-bounds";
import { MAX_AVATAR_REQUEST_BYTES } from "./user/avatar";

export const API_PREFIX = "api";

/**
 * HTTP setup shared by the server entry point and the integration tests, so
 * tests exercise the same middleware the real process runs.
 */
export function configureApp(app: NestExpressApplication): void {
  // MCP clients look for OAuth discovery at the root as well as under /api.
  app.setGlobalPrefix(API_PREFIX, { exclude: MCP_UNPREFIXED_ROUTES });
  app.disable("x-powered-by");
  // `request.ip` (stored on sessions) is the real client only behind
  // proxies listed in TRUSTED_PROXIES; otherwise it is the transport peer.
  app.set("trust proxy", trustedProxyMatcher());
  app.enableCors(buildCorsOptions());
  app.use(outsideApiNotFound);
  app.use(eventContextMiddleware);
  // Large boards return multi-MB JSON; gzip cuts that by 85-95%.
  app.use(compression());
  app.use(cookieParser());
  app.use(originCheck);
  // Ahead of the global parser, whose cap is far above an avatar upload's.
  app.use(
    `/${API_PREFIX}/user/avatar`,
    boundedJsonBody(MAX_AVATAR_REQUEST_BYTES),
  );
  app.use(`/${API_PREFIX}/mcp`, mcpOauthRequestBounds);
  app.use(jsonBodyParser());
  app.enableShutdownHooks();
}
