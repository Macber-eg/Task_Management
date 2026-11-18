import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager, Not } from "typeorm";
import { insertReturning, updateReturning } from "../../database/dml";
import { SessionEntity } from "../../database/entities/session.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { RealtimeConnections } from "../../realtime/realtime-connections";
import { isBanActive } from "../is-ban-active";
import { AccessTokenService } from "../tokens/access-token.service";
import {
  formatRefreshToken,
  hashTokenSecret,
  newTokenSecret,
  parseRefreshToken,
  sameHash,
} from "../tokens/refresh-token";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Two tabs can refresh at the same moment: one rotates, the other arrives
// with the token that was just replaced. Within this window that is treated
// as the race it is; after it, as a stolen token being replayed.
const ROTATION_GRACE_MS = 20_000;

export type SessionMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type LiveSession = { session: SessionEntity; user: UserEntity };

export type IssuedSession = LiveSession & {
  accessToken: string;
  /** Null when only the access token was reissued. */
  refreshToken: string | null;
};

type RotationOutcome =
  | { kind: "issued"; live: LiveSession; refreshToken: string | null }
  | { kind: "stolen"; sessionId: string }
  | { kind: "rejected" };

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/**
 * Login sessions. A row in `session` is one login: it backs the rotating
 * refresh token, carries the active workspace, and its deletion is what
 * revokes access. `rotated_at IS NULL` marks a row written by the previous
 * backend, whose `token` is still that backend's plaintext session token.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly accessTokens: AccessTokenService,
    private readonly realtime: RealtimeConnections,
  ) {}

  async create(user: UserEntity, meta: SessionMeta = {}): Promise<IssuedSession> {
    const manager = this.dataSource.manager;
    const now = new Date();
    const secret = newTokenSecret();

    const session = await insertReturning(manager, SessionEntity, {
      token: hashTokenSecret(secret),
      userId: user.id,
      expiresAt: expiryFrom(now),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      // A new login starts in the user's first workspace, if they have one.
      activeOrganizationId: await this.firstWorkspaceId(manager, user.id),
      kind: "browser",
      rotatedAt: now,
    });
    if (!session) throw new Error("Failed to create session");

    return this.issue(
      { session, user },
      formatRefreshToken(session.id, secret),
    );
  }

  /** Exchanges a refresh token for new tokens, or null if it is not valid. */
  async rotate(refreshToken: string): Promise<IssuedSession | null> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) return null;
    const presented = hashTokenSecret(parsed.secret);

    const outcome = await this.dataSource.transaction(
      async (manager): Promise<RotationOutcome> => {
        const session = await manager.findOne(SessionEntity, {
          where: { id: parsed.sessionId },
          lock: { mode: "pessimistic_write" },
        });
        const now = new Date();
        if (!session || session.expiresAt <= now) return { kind: "rejected" };

        const user = await manager.findOne(UserEntity, {
          where: { id: session.userId },
        });
        if (!user || isBanActive(user)) return { kind: "rejected" };

        if (sameHash(session.token, presented)) {
          const secret = newTokenSecret();
          const [rotated] = await updateReturning(
            manager,
            SessionEntity,
            {
              token: hashTokenSecret(secret),
              previousToken: session.token,
              rotatedAt: now,
              expiresAt: expiryFrom(now),
            },
            { id: session.id },
          );
          if (!rotated) return { kind: "rejected" };
          return {
            kind: "issued",
            live: { session: rotated, user },
            refreshToken: formatRefreshToken(session.id, secret),
          };
        }

        if (sameHash(session.previousToken, presented)) {
          const sinceRotation =
            now.getTime() - (session.rotatedAt?.getTime() ?? 0);
          if (sinceRotation <= ROTATION_GRACE_MS) {
            // The winner of the race already holds the new refresh token in
            // this browser's cookie jar; only a fresh access token is needed.
            return {
              kind: "issued",
              live: { session, user },
              refreshToken: null,
            };
          }
          await manager.delete(SessionEntity, { id: session.id });
          return { kind: "stolen", sessionId: session.id };
        }

        return { kind: "rejected" };
      },
    );

    if (outcome.kind === "stolen") {
      await this.realtime.revokeSessionConnections(outcome.sessionId);
    }
    if (outcome.kind !== "issued") return null;
    return this.issue(outcome.live, outcome.refreshToken);
  }

  /**
   * Converts a login made on the previous backend into a token-backed
   * session in place, so that user is not signed out by the switch.
   */
  async upgradeLegacy(legacyToken: string): Promise<IssuedSession | null> {
    const upgraded = await this.dataSource.transaction(async (manager) => {
      const session = await manager
        .createQueryBuilder(SessionEntity, "session")
        .setLock("pessimistic_write")
        .where("session.token = :token", { token: legacyToken })
        .andWhere("session.rotatedAt IS NULL")
        .getOne();
      const now = new Date();
      if (!session || session.expiresAt <= now) return null;

      const user = await manager.findOne(UserEntity, {
        where: { id: session.userId },
      });
      if (!user || isBanActive(user)) return null;

      const secret = newTokenSecret();
      const [rotated] = await updateReturning(
        manager,
        SessionEntity,
        {
          token: hashTokenSecret(secret),
          rotatedAt: now,
          expiresAt: expiryFrom(now),
        },
        { id: session.id },
      );
      if (!rotated) return null;
      return {
        live: { session: rotated, user },
        refreshToken: formatRefreshToken(session.id, secret),
      };
    });

    return upgraded ? this.issue(upgraded.live, upgraded.refreshToken) : null;
  }

  /** The session and its user, if the session still exists and is usable. */
  async findLive(sessionId: string): Promise<LiveSession | null> {
    const session = await this.dataSource.manager.findOne(SessionEntity, {
      where: { id: sessionId },
      relations: { user: true },
    });
    return this.usable(session);
  }

  /**
   * Resolves a non-JWT bearer token: a long-lived CLI or MCP token (stored
   * hashed), or a session token issued by the previous backend (stored as
   * is, and only matched while its row has not been upgraded).
   */
  async findByOpaqueToken(token: string): Promise<LiveSession | null> {
    const session = await this.dataSource.manager
      .createQueryBuilder(SessionEntity, "session")
      .leftJoinAndSelect("session.user", "user")
      .where(
        "(session.token = :hash AND session.kind IN ('device', 'mcp')) OR (session.token = :raw AND session.rotatedAt IS NULL)",
        { hash: hashTokenSecret(token), raw: token },
      )
      .getOne();
    return this.usable(session);
  }

  async issueAccessToken(live: LiveSession): Promise<string> {
    return this.accessTokens.sign({
      sub: live.user.id,
      sid: live.session.id,
    });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.dataSource.manager.delete(SessionEntity, { id: sessionId });
    await this.realtime.revokeSessionConnections(sessionId);
  }

  /** Ends every login of a user, optionally sparing the current one. */
  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const sessions = await manager.find(SessionEntity, {
      select: { id: true },
      where: exceptSessionId
        ? { userId, id: Not(exceptSessionId) }
        : { userId },
    });
    if (sessions.length === 0) return;

    await manager.delete(
      SessionEntity,
      sessions.map((session) => session.id),
    );
    for (const session of sessions) {
      await this.realtime.revokeSessionConnections(session.id);
    }
  }

  async setActiveOrganization(
    sessionId: string,
    organizationId: string | null,
  ): Promise<void> {
    await updateReturning(
      this.dataSource.manager,
      SessionEntity,
      { activeOrganizationId: organizationId },
      { id: sessionId },
    );
  }

  async setActiveTeam(sessionId: string, teamId: string | null): Promise<void> {
    await updateReturning(
      this.dataSource.manager,
      SessionEntity,
      { activeTeamId: teamId },
      { id: sessionId },
    );
  }

  private usable(session: SessionEntity | null): LiveSession | null {
    const user = session?.user;
    if (!session || !user) return null;
    if (session.expiresAt <= new Date() || isBanActive(user)) return null;
    return { session, user };
  }

  private async issue(
    live: LiveSession,
    refreshToken: string | null,
  ): Promise<IssuedSession> {
    return {
      ...live,
      accessToken: await this.issueAccessToken(live),
      refreshToken,
    };
  }

  private async firstWorkspaceId(
    manager: EntityManager,
    userId: string,
  ): Promise<string | null> {
    const [member] = (await manager.query(
      "SELECT workspace_id FROM workspace_member WHERE user_id = $1 LIMIT 1",
      [userId],
    )) as { workspace_id: string }[];
    return member?.workspace_id ?? null;
  }
}
