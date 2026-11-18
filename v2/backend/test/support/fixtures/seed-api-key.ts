import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { hashApiKey } from "../../../src/auth/api-key/hash-api-key";
import { ApikeyEntity } from "../../../src/database/entities/apikey.entity";
import { insertRow } from "./insert-row";

export type SeededApiKey = { key: string; row: ApikeyEntity };

/**
 * Stores a key for the user the way the previous backend's rows look, and
 * returns the secret alongside the row. Unset columns take the table's
 * defaults (10 requests per day).
 */
export async function seedApiKey(
  db: EntityManager,
  userId: string,
  overrides: Partial<ApikeyEntity> = {},
  key = `test-key-${randomUUID()}`.padEnd(64, "x"),
): Promise<SeededApiKey> {
  const now = new Date();
  const row = await insertRow(db, ApikeyEntity, {
    referenceId: userId,
    userId,
    key: hashApiKey(key),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  return { key, row };
}
