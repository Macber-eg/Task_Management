import { ApiError } from "../../common/errors/api-error";

// Codes and messages of the library the previous backend used; clients show
// the message and may match on the code.
const API_KEY_ERRORS = {
  SERVER_ONLY_PROPERTY: [
    400,
    "The property you're trying to set can only be set from the server auth instance only.",
  ],
  METADATA_DISABLED: [400, "Metadata is disabled."],
  EXPIRES_IN_IS_TOO_SMALL: [
    400,
    "The expiresIn is smaller than the predefined minimum value.",
  ],
  EXPIRES_IN_IS_TOO_LARGE: [
    400,
    "The expiresIn is larger than the predefined maximum value.",
  ],
  INVALID_PREFIX_LENGTH: [
    400,
    "The prefix length is either too large or too small.",
  ],
  INVALID_NAME_LENGTH: [
    400,
    "The name length is either too large or too small.",
  ],
  NO_VALUES_TO_UPDATE: [400, "No values to update."],
  UNAUTHORIZED_SESSION: [401, "Unauthorized or invalid session"],
  USER_BANNED: [401, "User is banned"],
  INVALID_API_KEY: [403, "Invalid API key."],
  USER_NOT_MEMBER_OF_ORGANIZATION: [
    403,
    "You are not a member of the organization that owns this API key.",
  ],
  INSUFFICIENT_API_KEY_PERMISSIONS: [
    403,
    "You do not have permission to perform this action on organization API keys.",
  ],
  KEY_NOT_FOUND: [404, "API Key not found"],
} as const satisfies Record<string, readonly [number, string]>;

export type ApiKeyErrorCode = keyof typeof API_KEY_ERRORS;

export function apiKeyError(code: ApiKeyErrorCode): ApiError {
  const [status, message] = API_KEY_ERRORS[code];
  return new ApiError(status, { code, message });
}
