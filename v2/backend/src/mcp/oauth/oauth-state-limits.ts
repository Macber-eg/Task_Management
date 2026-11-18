export type OauthStateKind = "client" | "code" | "request";

/**
 * Durable bounds on the shared OAuth state: total rows, inserts per minute,
 * outstanding rows per client (0 = unbounded), and the advisory lock each
 * kind serializes on.
 */
export const OAUTH_STATE_LIMITS = {
  client: { rows: 1_000, perMinute: 60, perClient: 0, lock: 1 },
  request: { rows: 10_000, perMinute: 300, perClient: 20, lock: 2 },
  code: { rows: 10_000, perMinute: 300, perClient: 20, lock: 3 },
} as const;

export const OAUTH_PAYLOAD_BYTES = 32 * 1024;
export const EXPIRED_STATE_BATCH = 100;
export const OAUTH_LOCK_NAMESPACE = 773621;
