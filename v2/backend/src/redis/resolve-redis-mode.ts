import { parseNodeList, type RedisNode } from "./parse-node-list";

export type RedisMode =
  | { mode: "cluster"; nodes: RedisNode[]; password?: string }
  | {
      mode: "sentinel";
      sentinels: RedisNode[];
      name: string;
      password?: string;
      sentinelPassword?: string;
      enableTLSForSentinelMode: boolean;
    }
  | { mode: "standalone"; url: string };

/** Cluster wins over Sentinel, which wins over a plain `REDIS_URL`. */
export function resolveRedisMode(): RedisMode {
  const clusterNodes = process.env.REDIS_CLUSTER_NODES;
  if (clusterNodes) {
    return {
      mode: "cluster",
      nodes: parseNodeList(clusterNodes, "REDIS_CLUSTER_NODES", 6379),
      password: process.env.REDIS_PASSWORD,
    };
  }

  const sentinels = process.env.REDIS_SENTINELS;
  if (sentinels) {
    return {
      mode: "sentinel",
      sentinels: parseNodeList(sentinels, "REDIS_SENTINELS", 26379),
      name: process.env.REDIS_SENTINEL_MASTER_NAME || "mymaster",
      password: process.env.REDIS_PASSWORD,
      sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
      enableTLSForSentinelMode: process.env.REDIS_SENTINEL_TLS === "true",
    };
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES must be set",
    );
  }
  return { mode: "standalone", url };
}
