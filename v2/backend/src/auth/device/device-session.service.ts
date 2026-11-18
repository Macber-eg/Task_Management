import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning } from "../../database/dml";
import { SessionEntity } from "../../database/entities/session.entity";
import type { UserEntity } from "../../database/entities/user.entity";
import { hashTokenSecret, newTokenSecret } from "../tokens/refresh-token";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DeviceSession = { session: SessionEntity; token: string };

/**
 * The login an approved CLI or MCP client receives. Installed clients keep
 * one opaque token and never refresh it, so it is a `device` session whose
 * expiry slides on use; only its SHA-256 is stored.
 */
@Injectable()
export class DeviceSessionService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    user: UserEntity,
    meta: { ipAddress: string | null; userAgent: string | null },
  ): Promise<DeviceSession | null> {
    const now = new Date();
    const token = newTokenSecret();
    const session = await insertReturning(this.dataSource.manager, SessionEntity, {
      token: hashTokenSecret(token),
      userId: user.id,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      kind: "device",
      // Set so the row is never mistaken for an un-upgraded legacy login.
      rotatedAt: now,
    });
    return session ? { session, token } : null;
  }
}
