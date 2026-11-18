import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { UserEntity } from "../../../src/database/entities/user.entity";
import { insertRow } from "./insert-row";

export function createUser(
  db: EntityManager,
  overrides: Partial<UserEntity> = {},
): Promise<UserEntity> {
  const id = overrides.id ?? `user-${randomUUID()}`;
  return insertRow(db, UserEntity, {
    id,
    email: `${id}@example.com`,
    emailVerified: true,
    name: "Integration Test User",
    ...overrides,
  });
}
