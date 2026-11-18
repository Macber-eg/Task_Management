import { apiKeyError } from "./api-key-error";
import { API_KEY_OPTIONS } from "./api-key-options";

const SECONDS_PER_DAY = 24 * 60 * 60;

/** When a key asked to live `expiresIn` seconds expires; null means never. */
export function apiKeyExpiry(expiresIn: number | null): Date | null {
  if (expiresIn === null) return null;

  const days = expiresIn / SECONDS_PER_DAY;
  if (days < API_KEY_OPTIONS.minExpiresInDays)
    throw apiKeyError("EXPIRES_IN_IS_TOO_SMALL");
  if (days > API_KEY_OPTIONS.maxExpiresInDays)
    throw apiKeyError("EXPIRES_IN_IS_TOO_LARGE");

  return new Date(Date.now() + expiresIn * 1000);
}
