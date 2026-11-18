import type { UserNotificationPreferenceEntity } from "../database/entities/user-notification-preference.entity";
import { decryptSecret } from "./secrets";

/** The preference with its ntfy, Gotify and webhook secrets in plaintext. */
export function decryptPreference(
  preference: UserNotificationPreferenceEntity,
): UserNotificationPreferenceEntity {
  return {
    ...preference,
    ntfyToken: decryptSecret(preference.ntfyToken) ?? null,
    gotifyToken: decryptSecret(preference.gotifyToken) ?? null,
    webhookSecret: decryptSecret(preference.webhookSecret) ?? null,
  };
}
