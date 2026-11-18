import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { DataSource } from "typeorm";
import { ApikeyEntity } from "../../database/entities/apikey.entity";
import { UserEntity } from "../../database/entities/user.entity";
import type { ApiKeyPrincipal } from "../principal";
import { apiKeySessionOutput } from "./api-key-session";

@Injectable()
export class ApiKeySessionService {
  constructor(private readonly dataSource: DataSource) {}

  /** The session get-session reports for a verified key, or null if it vanished meanwhile. */
  async sessionFor(apiKey: ApiKeyPrincipal, key: string, request: Request) {
    const manager = this.dataSource.manager;
    const [user, row] = await Promise.all([
      manager.findOne(UserEntity, { where: { id: apiKey.userId } }),
      manager.findOne(ApikeyEntity, {
        where: { id: apiKey.id },
        select: { id: true, expiresAt: true },
      }),
    ]);
    if (!user || !row) return null;

    return apiKeySessionOutput({
      user,
      apiKey: row,
      key,
      ipAddress: request.ip ?? null,
      userAgent: request.get("user-agent") ?? null,
    });
  }
}
