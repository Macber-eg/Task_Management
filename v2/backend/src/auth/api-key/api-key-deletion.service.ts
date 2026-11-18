import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ApikeyEntity } from "../../database/entities/apikey.entity";
import { UserEntity } from "../../database/entities/user.entity";
import type { Principal } from "../principal";
import { apiKeyError } from "./api-key-error";
import { ExpiredApiKeyCleanup } from "./expired-api-key-cleanup";
import { findOwnApiKey } from "./find-own-api-key";

@Injectable()
export class ApiKeyDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cleanup: ExpiredApiKeyCleanup,
  ) {}

  async deleteApiKey(principal: Principal, keyId: string) {
    const manager = this.dataSource.manager;

    // The flag alone refuses, even after a temporary ban has run out. An API
    // key caller carries no user row, so theirs is read here.
    const user =
      principal.user ??
      (await manager.findOne(UserEntity, {
        where: { id: principal.userId },
        select: { id: true, banned: true },
      }));
    if (user?.banned === true) throw apiKeyError("USER_BANNED");

    const apiKey = await findOwnApiKey(manager, keyId, principal.userId);
    await manager.delete(ApikeyEntity, { id: apiKey.id });

    void this.cleanup.run();
    return { success: true };
  }
}
