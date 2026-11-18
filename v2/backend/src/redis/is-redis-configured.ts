/** Redis fan-out is opt-in: a single instance runs without it. */
export function isRedisConfigured(): boolean {
  return !!(
    process.env.REDIS_URL ||
    process.env.REDIS_SENTINELS ||
    process.env.REDIS_CLUSTER_NODES
  );
}
