import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager, MoreThan } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { deleteReturning, insertReturning } from "../../database/dml";
import { McpOauthStateEntity } from "../../database/entities/mcp-oauth-state.entity";
import { oauthError } from "./oauth-error";
import {
  EXPIRED_STATE_BATCH,
  OAUTH_LOCK_NAMESPACE,
  OAUTH_PAYLOAD_BYTES,
  OAUTH_STATE_LIMITS,
  type OauthStateKind,
} from "./oauth-state-limits";

type Denial = "busy" | "rate" | "capacity" | "client" | "missing-request";

type StateRow = { payload: unknown; expires_at: Date };

function clientIdOf(payload: unknown): unknown {
  return payload && typeof payload === "object" && "clientId" in payload
    ? payload.clientId
    : undefined;
}

async function boundedCount(
  manager: EntityManager,
  where: string,
  parameters: unknown[],
  limit: number,
): Promise<number> {
  const [row] = (await manager.query(
    `SELECT count(*)::integer AS total FROM (
       SELECT id FROM mcp_oauth_state WHERE ${where} LIMIT ${limit}
     ) AS bounded_states`,
    parameters,
  )) as { total: number }[];
  return row?.total ?? limit;
}

/**
 * OAuth clients, consent requests and authorization codes, shared through
 * PostgreSQL so any replica can finish a flow another one started. Every
 * kind is bounded in rows, insert rate and (for requests and codes) rows
 * per client.
 */
@Injectable()
export class McpOauthStore {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Stores one state row. With `consumeRequestId`, the consent request is
   * deleted in the same transaction, so of concurrent approvals only one
   * issues a code.
   */
  async put(
    kind: OauthStateKind,
    key: string,
    payload: unknown,
    expiresAt: Date,
    consumeRequestId?: string,
  ): Promise<void> {
    const serialized = JSON.stringify(payload);
    if (
      typeof serialized !== "string" ||
      Buffer.byteLength(serialized) > OAUTH_PAYLOAD_BYTES ||
      key.length > 128
    ) {
      throw new HTTPException(413, { message: "OAuth state is too large" });
    }
    const clientId = clientIdOf(payload);
    const limits = OAUTH_STATE_LIMITS[kind];

    const denial = await this.dataSource.transaction(
      async (manager): Promise<Denial | null> => {
        // Separate fixed locks keep a registration flood from occupying the
        // code issuance lock. Try-lock bounds the queue during floods.
        const [lock] = (await manager.query(
          `SELECT pg_try_advisory_xact_lock($1, $2) AS acquired,
             (extract(epoch FROM now()) * 1000)::double precision AS "nowMs"`,
          [OAUTH_LOCK_NAMESPACE, limits.lock],
        )) as { acquired: boolean; nowMs: number }[];
        if (!lock?.acquired) return "busy";
        const now = new Date(Number(lock.nowMs));
        await this.sweepExpired(manager);

        const [rate] = (await manager.query(
          `SELECT payload, expires_at FROM mcp_oauth_state
           WHERE kind = 'rate' AND key = $1 LIMIT 1`,
          [kind],
        )) as StateRow[];
        const used =
          rate && rate.expires_at > now
            ? Number((rate.payload as { count?: number }).count ?? 0)
            : 0;
        if (!Number.isSafeInteger(used) || used < 0 || used >= limits.perMinute)
          return "rate";

        const total = await boundedCount(
          manager,
          "kind = $1",
          [kind],
          limits.rows,
        );
        if (total >= limits.rows) return "capacity";

        if (limits.perClient && typeof clientId === "string") {
          const clientTotal = await boundedCount(
            manager,
            "kind = $1 AND payload->>'clientId' = $2",
            [kind, clientId],
            limits.perClient,
          );
          if (clientTotal >= limits.perClient) return "client";
        }

        if (consumeRequestId) {
          const consumed = await deleteReturning(manager, McpOauthStateEntity, {
            kind: "request",
            key: consumeRequestId,
            expiresAt: MoreThan(now),
          });
          if (!consumed.length) return "missing-request";
        }

        await insertReturning(manager, McpOauthStateEntity, {
          kind,
          key,
          payload,
          expiresAt,
        });
        const rateExpires = new Date(
          (Math.floor(now.getTime() / 60_000) + 1) * 60_000,
        );
        await insertReturning(
          manager,
          McpOauthStateEntity,
          {
            kind: "rate",
            key: kind,
            payload: { count: used + 1 },
            expiresAt: rateExpires,
            updatedAt: new Date(),
          },
          {
            onConflict: {
              target: ["kind", "key"],
              update: ["payload", "expiresAt", "updatedAt"],
            },
          },
        );
        return null;
      },
    );

    // Denials are raised outside the transaction: expired-row cleanup must
    // commit even when a legacy over-cap table refuses this insert.
    if (denial === "missing-request") {
      throw oauthError(404, "invalid_or_expired_request");
    }
    if (denial) {
      throw oauthError(429, "temporarily_unavailable", {
        description: "OAuth capacity reached; retry later",
        headers: {
          "Retry-After": denial === "busy" ? "1" : "60",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  async get<T>(kind: OauthStateKind, key: string): Promise<T | null> {
    const row = await this.dataSource.manager.findOne(McpOauthStateEntity, {
      where: { kind, key },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    return row.payload as T;
  }

  /** A single DELETE ... RETURNING keeps consumption single-use across replicas. */
  async consume<T>(kind: OauthStateKind, key: string): Promise<T | null> {
    const [row] = await deleteReturning(
      this.dataSource.manager,
      McpOauthStateEntity,
      { kind, key },
    );
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    return row.payload as T;
  }

  async deleteExpired(): Promise<void> {
    await this.sweepExpired(this.dataSource.manager);
  }

  private async sweepExpired(manager: EntityManager): Promise<void> {
    // Never an unbounded delete, and never a live consent request. The fixed
    // rate-counter rows are reused rather than accumulated per window.
    await manager.query(
      `DELETE FROM mcp_oauth_state WHERE id IN (
         SELECT id FROM mcp_oauth_state
         WHERE kind <> 'rate' AND expires_at <= (now() AT TIME ZONE 'UTC')
         ORDER BY expires_at LIMIT ${EXPIRED_STATE_BATCH}
         FOR UPDATE SKIP LOCKED
       )`,
    );
  }
}
