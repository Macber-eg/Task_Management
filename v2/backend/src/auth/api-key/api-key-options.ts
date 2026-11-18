/**
 * How the previous backend configured its API key plugin, including the
 * plugin defaults it relied on. Stored keys and clients depend on these.
 */
export const API_KEY_OPTIONS = {
  /** Random letters after the optional prefix. */
  keyLength: 64,
  /** Leading characters of the key kept in `start` so users can tell keys apart. */
  startLength: 6,
  maxPrefixLength: 32,
  minNameLength: 1,
  maxNameLength: 32,
  minExpiresInDays: 1,
  maxExpiresInDays: 365,
  rateLimit: { enabled: true, maxRequests: 100, timeWindow: 60_000 },
} as const;
