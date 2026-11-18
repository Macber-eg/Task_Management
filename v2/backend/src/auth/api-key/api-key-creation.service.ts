import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning } from "../../database/dml";
import { ApikeyEntity } from "../../database/entities/apikey.entity";
import { apiKeyError } from "./api-key-error";
import { apiKeyExpiry } from "./api-key-expiry";
import { API_KEY_OPTIONS } from "./api-key-options";
import { toApiKeyOutput } from "./api-key-output";
import { ExpiredApiKeyCleanup } from "./expired-api-key-cleanup";
import { hashApiKey } from "./hash-api-key";
import { ALPHANUMERIC, LETTERS, randomString } from "./random-string";
import type { CreateApiKeyInput } from "./schema";

@Injectable()
export class ApiKeyCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cleanup: ExpiredApiKeyCleanup,
  ) {}

  /** The stored key plus `key`, the secret, which is never readable again. */
  async createApiKey(userId: string, input: CreateApiKeyInput) {
    if (
      input.refillAmount !== undefined ||
      input.refillInterval !== undefined ||
      input.rateLimitMax !== undefined ||
      input.rateLimitTimeWindow !== undefined ||
      input.rateLimitEnabled !== undefined ||
      input.permissions !== undefined ||
      input.remaining !== null
    ) {
      throw apiKeyError("SERVER_ONLY_PROPERTY");
    }
    if (input.userId !== undefined) throw apiKeyError("UNAUTHORIZED_SESSION");
    if (input.metadata) throw apiKeyError("METADATA_DISABLED");

    const expiresAt = apiKeyExpiry(input.expiresIn);
    if (input.prefix && input.prefix.length > API_KEY_OPTIONS.maxPrefixLength) {
      throw apiKeyError("INVALID_PREFIX_LENGTH");
    }
    if (input.name && input.name.length > API_KEY_OPTIONS.maxNameLength) {
      throw apiKeyError("INVALID_NAME_LENGTH");
    }

    void this.cleanup.run();

    const key = `${input.prefix ?? ""}${randomString(API_KEY_OPTIONS.keyLength, LETTERS)}`;
    const now = new Date();
    const apiKey = await insertReturning(
      this.dataSource.manager,
      ApikeyEntity,
      {
        // The id format the previous backend generated.
        id: randomString(32, ALPHANUMERIC),
        configId: "default",
        createdAt: now,
        updatedAt: now,
        name: input.name ?? null,
        prefix: input.prefix ?? null,
        start: key.substring(0, API_KEY_OPTIONS.startLength),
        key: hashApiKey(key),
        enabled: true,
        expiresAt,
        referenceId: userId,
        lastRefillAt: null,
        lastRequest: null,
        // The previous backend JSON-encoded this column even when a key had
        // no metadata, so "none" is the text `null`, not SQL NULL.
        metadata: "null",
        rateLimitMax: API_KEY_OPTIONS.rateLimit.maxRequests,
        rateLimitTimeWindow: API_KEY_OPTIONS.rateLimit.timeWindow,
        rateLimitEnabled: API_KEY_OPTIONS.rateLimit.enabled,
        remaining: null,
        refillAmount: null,
        refillInterval: null,
        requestCount: 0,
      },
    );
    if (!apiKey) throw new Error("Failed to create API key");

    return { ...toApiKeyOutput(apiKey), key };
  }
}
