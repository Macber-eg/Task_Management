export type TokenRequest = {
  code: string;
  client_id: string;
  code_verifier: string;
  redirect_uri: string;
};

export type TokenRequestResult =
  | { ok: true; request: TokenRequest }
  | { ok: false; error: "invalid_request" | "unsupported_grant_type" };

function parseParams(
  contentType: string,
  text: string,
): Record<string, unknown> | null {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    const input: unknown = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    return input as Record<string, unknown>;
  } catch {
    return null;
  }
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Reads an authorization-code grant from a form or JSON token request. */
export function parseTokenRequest(
  contentType: string,
  text: string,
): TokenRequestResult {
  const params = parseParams(contentType, text);
  if (!params) return { ok: false, error: "invalid_request" };

  const { grant_type, code, client_id, code_verifier, redirect_uri } = params;
  if (grant_type !== "authorization_code") {
    return { ok: false, error: "unsupported_grant_type" };
  }
  if (
    !boundedString(code, 128) ||
    !boundedString(client_id, 128) ||
    !boundedString(code_verifier, 128) ||
    !boundedString(redirect_uri, 2048)
  ) {
    return { ok: false, error: "invalid_request" };
  }
  return {
    ok: true,
    request: { code, client_id, code_verifier, redirect_uri },
  };
}
