import { refreshSession } from "@/lib/api/refresh-session";

/** Close code the API sends when the socket's access token is missing or expired. */
export const WS_AUTH_EXPIRED = 4401;

/**
 * A socket that closes before it opens, or with 4401, may only need a fresh
 * access cookie. Allows one session refresh per run of failed connections;
 * a successful open starts a new run.
 */
export function createSocketAuthRetry() {
  let attempted = false;

  return {
    opened() {
      attempted = false;
    },
    /**
     * Starts a refresh when this close calls for one and resolves whether it
     * succeeded; `null` means the caller should use its normal retry.
     */
    refreshFor(code: number | undefined, wasOpen: boolean) {
      if (attempted || (wasOpen && code !== WS_AUTH_EXPIRED)) return null;
      attempted = true;
      return refreshSession();
    },
  };
}
