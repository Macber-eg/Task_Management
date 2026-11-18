import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ApikeyEntity } from "../../database/entities/apikey.entity";
import type { ApiKeyPrincipal } from "../principal";
import { activeApiKeyQuery } from "./active-api-key-query";
import { evaluateApiKeyUsage } from "./api-key-usage";
import { hashApiKey } from "./hash-api-key";
import { parseApiKeyPermissions } from "./parse-api-key-permissions";
import type { ApiKeyDenial, ApiKeyRateLimit } from "./rate-limit-headers";

export type VerifiedApiKey = {
  status: "valid";
  rateLimit: ApiKeyRateLimit | null;
  key: ApiKeyPrincipal;
};

function verified(
  apiKey: ApikeyEntity,
  rateLimit: ApiKeyRateLimit | null,
): VerifiedApiKey {
  return {
    status: "valid",
    rateLimit,
    key: {
      id: apiKey.id,
      userId: apiKey.referenceId,
      enabled: apiKey.enabled ?? false,
      permissions: parseApiKeyPermissions(apiKey.permissions),
    },
  };
}

@Injectable()
export class ApiKeyVerifier {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Null for a key that cannot be used at all, a denial for one that is over
   * its rate limit or quota. `consume: false` reads the key's standing
   * without spending a request or waiting for its row lock.
   */
  async verify(
    key: string,
    options: { consume: boolean },
  ): Promise<VerifiedApiKey | ApiKeyDenial | null> {
    const hashedKey = hashApiKey(key);

    if (!options.consume) {
      const apiKey = await activeApiKeyQuery(
        this.dataSource.manager,
        hashedKey,
      ).getOne();
      if (!apiKey) return null;

      const usage = evaluateApiKeyUsage(apiKey, new Date(), false);
      if (usage.status !== "valid") return usage;
      return verified(apiKey, usage.rateLimit);
    }

    return this.dataSource.transaction(async (manager) => {
      const apiKey = await activeApiKeyQuery(manager, hashedKey)
        .setLock("pessimistic_write")
        .getOne();
      if (!apiKey) return null;

      // A key may expire while SELECT waits for another request's row lock.
      const now = new Date();
      if (apiKey.expiresAt && apiKey.expiresAt <= now) return null;

      // Locking the key serializes quota/refill and window accounting across API
      // instances. Neither a stale lookup nor a rejected request can restore quota.
      const usage = evaluateApiKeyUsage(apiKey, now, true);
      if (usage.status !== "valid") return usage;

      await manager.update(
        ApikeyEntity,
        { id: apiKey.id },
        {
          remaining: usage.remaining,
          lastRefillAt: usage.lastRefillAt,
          requestCount: usage.requestCount,
          lastRequest: now,
          updatedAt: now,
        },
      );

      return verified(apiKey, usage.rateLimit);
    });
  }
}
