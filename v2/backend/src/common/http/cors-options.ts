import { Logger } from "@nestjs/common";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/** Origins allowed to call the API with credentials. */
export function resolveCorsOrigins(): string[] | undefined {
  const source = [process.env.CORS_ORIGINS, process.env.KANEO_CLIENT_URL].find(
    (value) => value?.trim(),
  );
  const origins = source
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV !== "production" && origins?.length) {
    for (const origin of [...origins]) {
      if (origin.includes("localhost")) {
        origins.push(origin.replace("localhost", "127.0.0.1"));
      } else if (origin.includes("127.0.0.1")) {
        origins.push(origin.replace("127.0.0.1", "localhost"));
      }
    }
  }

  return origins;
}

export function buildCorsOptions(): CorsOptions {
  const corsOrigins = resolveCorsOrigins();
  const reflectUnconfiguredOrigins = process.env.NODE_ENV !== "production";

  if (!corsOrigins && !reflectUnconfiguredOrigins) {
    new Logger("Cors").warn(
      "Neither CORS_ORIGINS nor KANEO_CLIENT_URL is set, so cross-origin requests are refused. Set KANEO_CLIENT_URL if the web app is served from another origin.",
    );
  }

  return {
    credentials: true,
    exposedHeaders: [
      "Retry-After",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    origin: (origin, callback) => {
      // Reflecting an arbitrary origin alongside credentials lets any site
      // read authenticated responses, so it stays a development convenience.
      if (!corsOrigins) {
        callback(null, reflectUnconfiguredOrigins ? origin || "*" : false);
        return;
      }
      callback(null, origin && corsOrigins.includes(origin) ? origin : false);
    },
  };
}
