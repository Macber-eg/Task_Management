import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { boundedJsonBody } from "./common/http/bounded-json-body";
import { buildCorsOptions } from "./common/http/cors-options";
import { jsonBodyParser } from "./common/http/json-body-parser";
import { originCheck } from "./common/http/origin-check";
import { outsideApiNotFound } from "./common/http/outside-api-not-found";
import { eventContextMiddleware } from "./events/event-context";
import { MAX_AVATAR_REQUEST_BYTES } from "./user/avatar";

export const API_PREFIX = "api";

/**
 * HTTP setup shared by the server entry point and the integration tests, so
 * tests exercise the same middleware the real process runs.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.disable("x-powered-by");
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
  app.use(jsonBodyParser());
  app.enableShutdownHooks();
}
