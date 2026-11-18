import type { UserEntity } from "../../database/entities/user.entity";

// The user fields an administrator's update may write; anything else in the
// request is ignored, as the previous backend's auth library did.
const WRITABLE_FIELDS = [
  "name",
  "email",
  "emailVerified",
  "image",
  "createdAt",
  "locale",
  "isAnonymous",
  "role",
  "banned",
  "banReason",
  "banExpires",
] as const satisfies readonly (keyof UserEntity)[];

const DATE_FIELDS = new Set(["createdAt", "banExpires"]);

/** The writable fields of an update request, dates parsed. */
export function pickWritableUserData(
  data: Record<string, unknown>,
): Partial<UserEntity> {
  const values: Record<string, unknown> = {};
  for (const field of WRITABLE_FIELDS) {
    if (!Object.hasOwn(data, field)) continue;
    const value = data[field];
    values[field] =
      DATE_FIELDS.has(field) &&
      (typeof value === "string" || typeof value === "number")
        ? new Date(value)
        : value;
  }
  return values as Partial<UserEntity>;
}
