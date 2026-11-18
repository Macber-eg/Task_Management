type JsonResult = { data: Record<string, unknown> | null; status: number };

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A provider API read: the JSON body, or null when the call failed. */
export async function getProviderJson(
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown> | unknown[] | null> {
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object"
    ? (value as Record<string, unknown> | unknown[])
    : null;
}

export type TokenRequest = {
  code: string;
  codeVerifier?: string;
  redirectURI: string;
  clientId: string;
  clientSecret?: string;
};

/** The authorization-code grant, with the client credentials in the body. */
function tokenRequestBody(request: TokenRequest): URLSearchParams {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", request.code);
  if (request.codeVerifier) body.set("code_verifier", request.codeVerifier);
  body.set("redirect_uri", request.redirectURI);
  body.set("client_id", request.clientId);
  if (request.clientSecret) body.set("client_secret", request.clientSecret);
  return body;
}

/**
 * Posts an authorization-code grant. With `refuseRedirects` a redirect is a
 * failure: a token endpoint that redirects would carry the code and secret
 * somewhere else.
 */
export async function postTokenRequest(
  tokenEndpoint: string,
  request: TokenRequest,
  options: { refuseRedirects: boolean },
): Promise<JsonResult> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: tokenRequestBody(request),
    redirect: options.refuseRedirects ? "manual" : "follow",
  });
  return { data: await readJson(response), status: response.status };
}

export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}
