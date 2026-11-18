import type { EntityManager, SelectQueryBuilder } from "typeorm";
import { ApikeyEntity } from "../../database/entities/apikey.entity";

/**
 * The key with this hash, if it may be used at all: enabled, not expired,
 * and owned by a user who is not banned.
 */
export function activeApiKeyQuery(
  manager: EntityManager,
  hashedKey: string,
): SelectQueryBuilder<ApikeyEntity> {
  return manager
    .createQueryBuilder(ApikeyEntity, "apikey")
    .where("apikey.key = :hashedKey", { hashedKey })
    .andWhere("apikey.enabled = true")
    .andWhere(
      `EXISTS (
        SELECT 1 FROM "user" AS owner
        WHERE owner.id = apikey.reference_id
          AND (
            owner.banned IS NULL
            OR owner.banned = false
            OR (owner.ban_expires IS NOT NULL AND owner.ban_expires < :now)
          )
      )`,
    )
    .andWhere("(apikey.expires_at IS NULL OR apikey.expires_at > :now)", {
      now: new Date(),
    })
    .limit(1);
}
