import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { updateReturning } from "../../database/dml";
import { ApikeyEntity } from "../../database/entities/apikey.entity";
import { apiKeyError } from "./api-key-error";
import { apiKeyExpiry } from "./api-key-expiry";
import { API_KEY_OPTIONS } from "./api-key-options";
import { toApiKeyOutput } from "./api-key-output";
import { ExpiredApiKeyCleanup } from "./expired-api-key-cleanup";
import { findOwnApiKey } from "./find-own-api-key";
import type { UpdateApiKeyInput } from "./schema";

@Injectable()
export class ApiKeyUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cleanup: ExpiredApiKeyCleanup,
  ) {}

  /**
   * Renames, enables or disables a key, or moves its expiry. `updatedAt` is
   * left alone, as before: only using the key moves it. Metadata is ignored
   * because the previous backend had it switched off.
   */
  async updateApiKey(userId: string, input: UpdateApiKeyInput) {
    if (input.userId && input.userId !== userId) {
      throw apiKeyError("UNAUTHORIZED_SESSION");
    }
    if (
      input.refillAmount !== undefined ||
      input.refillInterval !== undefined ||
      input.rateLimitMax !== undefined ||
      input.rateLimitTimeWindow !== undefined ||
      input.rateLimitEnabled !== undefined ||
      input.remaining !== undefined ||
      input.permissions !== undefined
    ) {
      throw apiKeyError("SERVER_ONLY_PROPERTY");
    }

    const manager = this.dataSource.manager;
    const apiKey = await findOwnApiKey(manager, input.keyId, userId);

    const changes: QueryDeepPartialEntity<ApikeyEntity> = {};
    if (input.name !== undefined) {
      if (
        input.name.length < API_KEY_OPTIONS.minNameLength ||
        input.name.length > API_KEY_OPTIONS.maxNameLength
      ) {
        throw apiKeyError("INVALID_NAME_LENGTH");
      }
      changes.name = input.name;
    }
    if (input.enabled !== undefined) changes.enabled = input.enabled;
    if (input.expiresIn !== undefined) {
      changes.expiresAt = apiKeyExpiry(input.expiresIn);
    }
    if (Object.keys(changes).length === 0) {
      throw apiKeyError("NO_VALUES_TO_UPDATE");
    }

    const [updated] = await updateReturning(manager, ApikeyEntity, changes, {
      id: apiKey.id,
    });

    void this.cleanup.run();
    return toApiKeyOutput(updated ?? apiKey);
  }
}
