import { ApiError } from "../../common/errors/api-error";

// Codes and messages of the previous backend's OAuth endpoints; clients
// match on them.
const OAUTH_ERRORS = {
  PROVIDER_NOT_FOUND: [404, "Provider not found"],
  ID_TOKEN_NOT_SUPPORTED: [404, "id_token not supported"],
  INVALID_OAUTH_CONFIGURATION: [400, "Invalid OAuth configuration"],
} as const satisfies Record<string, readonly [number, string]>;

export type OAuthErrorCode = keyof typeof OAUTH_ERRORS;

export function oauthError(code: OAuthErrorCode): ApiError {
  const [status, message] = OAUTH_ERRORS[code];
  return new ApiError(status, { code, message });
}
