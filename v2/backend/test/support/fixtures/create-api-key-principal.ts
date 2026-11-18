import type { EntityManager } from "typeorm";
import type { Principal } from "../../../src/auth/principal";
import { ApikeyEntity } from "../../../src/database/entities/apikey.entity";
import type { UserEntity } from "../../../src/database/entities/user.entity";
import { insertRow } from "./insert-row";

/**
 * The caller the authenticator produces for a valid API key of this user:
 * no user or session entity, and the key's own permission scope if it has one.
 */
export async function createApiKeyPrincipal(
  db: EntityManager,
  user: UserEntity,
  permissions: Record<string, string[]> | null = null,
): Promise<Principal> {
  const now = new Date();
  const apiKey = await insertRow(db, ApikeyEntity, {
    referenceId: user.id,
    userId: user.id,
    key: `hashed-key-${user.id}`,
    createdAt: now,
    updatedAt: now,
  });
  return {
    userId: user.id,
    userEmail: "",
    user: null,
    session: null,
    apiKey: { id: apiKey.id, userId: user.id, enabled: true, permissions },
  };
}
