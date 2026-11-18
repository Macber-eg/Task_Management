import { HTTPException } from "../common/errors/http-exception";

function configuredOrigins(): Array<string | undefined> {
  const configured = [
    process.env.KANEO_CLIENT_URL,
    process.env.KANEO_API_URL,
    ...(process.env.CORS_ORIGINS ?? "").split(","),
  ];
  if (process.env.NODE_ENV !== "production") {
    if (!process.env.KANEO_CLIENT_URL) configured.push("http://localhost:5173");
    if (!process.env.KANEO_API_URL) configured.push("http://localhost:1337");
  }
  return configured;
}

function isConfiguredOrigin(origin: string) {
  for (const value of configuredOrigins()) {
    if (!value?.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        url.origin === origin
      ) {
        return true;
      }
    } catch {
      // Invalid entries and wildcards do not grant access.
    }
  }
  return false;
}

/**
 * Browsers attach cookies to cross-site WebSocket handshakes, so a browser
 * origin must be one this deployment serves. Never compared with Host or
 * forwarding headers, which the caller controls.
 */
export function assertWebSocketOrigin(headers: Headers): void {
  const origin = headers.get("origin");
  if (origin === null) {
    // Native clients may omit Origin, but must supply explicit credentials.
    // Authentication still validates them and rejects invalid tokens; a
    // cookie alone must never bypass the browser-origin boundary.
    if (
      /^Bearer\s+\S+$/i.test(headers.get("authorization") ?? "") ||
      headers.get("x-api-key")?.trim()
    ) {
      return;
    }
  } else if (isConfiguredOrigin(origin)) {
    return;
  }
  throw new HTTPException(403, { message: "WebSocket origin is not allowed" });
}
