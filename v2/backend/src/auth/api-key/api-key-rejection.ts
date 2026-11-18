import { HTTPException } from "../../common/errors/http-exception";
import { type ApiKeyDenial, apiKeyDenialHeaders } from "./rate-limit-headers";

/** The 429 a key that exists but may not be used right now is answered with. */
export function apiKeyRejection(denial: ApiKeyDenial, now = new Date()) {
  const message =
    denial.status === "rate_limited"
      ? "Rate limit exceeded"
      : "API key usage limit exceeded";
  return new HTTPException(429, {
    message,
    res: new Response(message, {
      status: 429,
      headers: apiKeyDenialHeaders(denial, now),
    }),
  });
}
