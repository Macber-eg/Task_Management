import type { ApiRequest } from "../../auth/principal";

/** Access rules run before validation, so they read the raw JSON body. */
export function jsonBody(request: ApiRequest): Record<string, unknown> {
  const raw: unknown = request.body;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}
