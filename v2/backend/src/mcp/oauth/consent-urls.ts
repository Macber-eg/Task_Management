function clientUrl(): string {
  return process.env.KANEO_CLIENT_URL || "http://localhost:5173";
}

/** The web app's consent page for a pending request. */
export function consentPageUrl(requestId: string): string {
  const url = new URL("/mcp/authorize", clientUrl());
  url.searchParams.set("request_id", requestId);
  return url.toString();
}

/** Only the web app itself may submit a consent decision. */
export function isTrustedConsentOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(clientUrl()).origin;
  } catch {
    return false;
  }
}

/** Back to the client's redirect URI; an empty `state` is still echoed. */
export function authorizationRedirect(
  request: { redirectUri: string; state?: string },
  params: Record<string, string>,
): string {
  const url = new URL(request.redirectUri);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  if (request.state !== undefined) {
    url.searchParams.set("state", request.state);
  }
  return url.toString();
}
