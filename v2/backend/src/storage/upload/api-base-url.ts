import type { Request } from "express";
import { normalizeApiServerUrl } from "../../common/openapi/openapi-document.service";

/** Where clients read stored files back from: `KANEO_API_URL`, else this request's origin. */
export function apiBaseUrl(request: Request): string {
  return normalizeApiServerUrl(
    process.env.KANEO_API_URL || `${request.protocol}://${request.get("host")}`,
  );
}
