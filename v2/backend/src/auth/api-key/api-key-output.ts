import type { ApikeyEntity } from "../../database/entities/apikey.entity";

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** A key as the endpoints return it: never the hash, JSON columns parsed. */
export function toApiKeyOutput(apiKey: ApikeyEntity) {
  const metadata = parseJson(apiKey.metadata);

  return {
    id: apiKey.id,
    configId: apiKey.configId,
    name: apiKey.name,
    start: apiKey.start,
    referenceId: apiKey.referenceId,
    prefix: apiKey.prefix,
    refillInterval: apiKey.refillInterval,
    refillAmount: apiKey.refillAmount,
    lastRefillAt: apiKey.lastRefillAt,
    enabled: apiKey.enabled,
    rateLimitEnabled: apiKey.rateLimitEnabled,
    rateLimitTimeWindow: apiKey.rateLimitTimeWindow,
    rateLimitMax: apiKey.rateLimitMax,
    requestCount: apiKey.requestCount,
    remaining: apiKey.remaining,
    lastRequest: apiKey.lastRequest,
    expiresAt: apiKey.expiresAt,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
    permissions: parseJson(apiKey.permissions),
    // Rows written by early versions of the previous backend hold the
    // metadata JSON encoded twice.
    metadata: typeof metadata === "string" ? parseJson(metadata) : metadata,
  };
}
