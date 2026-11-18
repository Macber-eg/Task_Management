import { ApiError } from "../common/errors/api-error";

// Codes and messages clients already match on (they come from the library
// the previous backend used). Changing one is a contract change.
const AUTH_ERRORS = {
  INVALID_EMAIL: [400, "Invalid email"],
  INVALID_PASSWORD: [400, "Invalid password"],
  PASSWORD_TOO_SHORT: [400, "Password too short"],
  PASSWORD_TOO_LONG: [400, "Password too long"],
  EMAIL_CAN_NOT_BE_UPDATED: [400, "Email can not be updated"],
  CREDENTIAL_ACCOUNT_NOT_FOUND: [400, "Credential account not found"],
  FAILED_TO_CREATE_USER: [422, "Failed to create user"],
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: [
    422,
    "User already exists. Use another email.",
  ],
  INVALID_EMAIL_OR_PASSWORD: [401, "Invalid email or password"],
  UNAUTHORIZED: [401, "Unauthorized"],
  SESSION_EXPIRED: [401, "Session expired"],
  BANNED_USER: [
    403,
    "You have been banned from this application. Please contact support if you believe this is an error.",
  ],
  LOCAL_SIGN_IN_DISABLED: [
    403,
    "Local sign-in is disabled. Please use a configured social or OIDC sign-in method.",
  ],
  PASSWORD_REGISTRATION_DISABLED: [
    403,
    "Password registration is currently disabled. Please use a configured social or OIDC sign-in method.",
  ],
  DISPOSABLE_EMAIL_NOT_ALLOWED: [
    400,
    "Sign-up with disposable email addresses is not allowed.",
  ],
} as const satisfies Record<string, readonly [number, string]>;

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

export function authError(code: AuthErrorCode, message?: string): ApiError {
  const [status, defaultMessage] = AUTH_ERRORS[code];
  return new ApiError(status, { code, message: message ?? defaultMessage });
}
