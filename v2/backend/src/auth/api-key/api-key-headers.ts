import type { Request } from "express";

type ApiKeyHeadersRequest = Request & {
  apiKeyHeaders?: Record<string, string>;
};

/** Headers the verified key adds to whatever response this request gets. */
export function recordApiKeyHeaders(
  request: Request,
  headers: Record<string, string>,
): void {
  (request as ApiKeyHeadersRequest).apiKeyHeaders = headers;
}

export function recordedApiKeyHeaders(
  request: Request,
): Record<string, string> {
  return (request as ApiKeyHeadersRequest).apiKeyHeaders ?? {};
}
