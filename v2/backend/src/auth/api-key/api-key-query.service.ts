import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ApikeyEntity } from "../../database/entities/apikey.entity";
import { toApiKeyOutput } from "./api-key-output";
import { assertOrganizationApiKeyAccess } from "./assert-organization-api-key-access";
import { ExpiredApiKeyCleanup } from "./expired-api-key-cleanup";
import { findOwnApiKey } from "./find-own-api-key";
import type { ListApiKeysQuery } from "./schema";

/** The previous backend never read more than this many of a user's keys. */
const MAX_LISTED_KEYS = 100;

@Injectable()
export class ApiKeyQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cleanup: ExpiredApiKeyCleanup,
  ) {}

  async getApiKey(userId: string, id: string) {
    const apiKey = await findOwnApiKey(this.dataSource.manager, id, userId);
    void this.cleanup.run();
    return toApiKeyOutput(apiKey);
  }

  async listApiKeys(userId: string, query: ListApiKeysQuery) {
    const manager = this.dataSource.manager;
    const { limit, offset } = query;

    // Keys belong to users, so a workspace has none; the filter only
    // answers whether the caller would be allowed to see them.
    if (query.organizationId) {
      await assertOrganizationApiKeyAccess(
        manager,
        userId,
        query.organizationId,
      );
      void this.cleanup.run();
      return { apiKeys: [], total: 0, limit, offset };
    }

    const owned = await manager.find(ApikeyEntity, {
      where: { referenceId: userId },
      order: query.sortBy
        ? { [query.sortBy]: query.sortDirection ?? "asc" }
        : { createdAt: "asc", id: "asc" },
      take: MAX_LISTED_KEYS,
    });
    const matching = query.configId
      ? owned.filter((apiKey) => apiKey.configId === query.configId)
      : owned;
    const page = matching.slice(
      offset ?? 0,
      limit === undefined ? undefined : (offset ?? 0) + limit,
    );

    void this.cleanup.run();
    return {
      apiKeys: page.map(toApiKeyOutput),
      total: matching.length,
      limit,
      offset,
    };
  }
}
