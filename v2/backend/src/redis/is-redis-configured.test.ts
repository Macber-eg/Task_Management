import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRedisConfigured } from "./is-redis-configured";

describe("isRedisConfigured", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_SENTINELS;
    delete process.env.REDIS_CLUSTER_NODES;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns false when no Redis env vars are set", () => {
    expect(isRedisConfigured()).toBe(false);
  });

  it("returns true when REDIS_URL is set", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    expect(isRedisConfigured()).toBe(true);
  });

  it("returns true when REDIS_SENTINELS is set", () => {
    process.env.REDIS_SENTINELS = "sentinel-1:26379";
    expect(isRedisConfigured()).toBe(true);
  });

  it("returns true when REDIS_CLUSTER_NODES is set", () => {
    process.env.REDIS_CLUSTER_NODES = "node-1:6379,node-2:6379";
    expect(isRedisConfigured()).toBe(true);
  });

  it("returns true when multiple Redis env vars are set", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.REDIS_SENTINELS = "sentinel-1:26379";
    process.env.REDIS_CLUSTER_NODES = "node-1:6379";
    expect(isRedisConfigured()).toBe(true);
  });
});
