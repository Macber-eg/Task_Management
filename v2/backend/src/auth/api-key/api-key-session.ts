import type { UserEntity } from "../../database/entities/user.entity";
import { userOutput } from "../sessions/session-output";

/** How long the previous backend's sessions lasted; a key without expiry borrowed it. */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type ApiKeySessionInput = {
  user: UserEntity;
  apiKey: { id: string; expiresAt: Date | null };
  key: string;
  ipAddress: string | null;
  userAgent: string | null;
};

/**
 * What get-session answers an API key caller: the session the previous
 * backend's auth library made up for the key. Its id is the key's id and
 * its token is the key itself, which the caller already holds.
 */
export function apiKeySessionOutput(input: ApiKeySessionInput, now = new Date()) {
  return {
    user: userOutput(input.user),
    session: {
      id: input.apiKey.id,
      token: input.key,
      userId: input.user.id,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      createdAt: now,
      updatedAt: now,
      expiresAt:
        input.apiKey.expiresAt ?? new Date(now.getTime() + SESSION_LIFETIME_MS),
    },
  };
}
