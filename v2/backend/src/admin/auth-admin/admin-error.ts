import { ApiError } from "../../common/errors/api-error";

// Codes and messages of the auth library the previous backend used for its
// admin endpoints, plus Kaneo's own rules on top. Clients match on them.
const ADMIN_ERRORS = {
  USER_NOT_FOUND: [404, "User not found"],
  INVALID_EMAIL: [400, "Invalid email"],
  NO_DATA_TO_UPDATE: [400, "No data to update"],
  INVALID_ROLE_TYPE: [400, "Invalid role type"],
  PASSWORD_CANNOT_BE_UPDATED_VIA_UPDATE_USER: [
    400,
    "Password cannot be updated through update-user. Use the set-user-password endpoint instead",
  ],
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: [
    400,
    "User already exists. Use another email.",
  ],
  YOU_CANNOT_BAN_YOURSELF: [400, "You cannot ban yourself"],
  YOU_CANNOT_REMOVE_YOURSELF: [400, "You cannot remove yourself"],
  YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: [
    403,
    "You are not allowed to change users role",
  ],
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS: [
    403,
    "You are not allowed to update users",
  ],
  YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: [403, "You are not allowed to ban users"],
  YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS: [
    403,
    "You are not allowed to delete users",
  ],
  YOU_ARE_NOT_ALLOWED_TO_SET_USERS_EMAIL: [
    403,
    "You are not allowed to update users email",
  ],
  YOU_CANNOT_CHANGE_YOUR_OWN_ROLE: [400, "You cannot change your own role."],
  CANNOT_REMOVE_LAST_ADMIN: [
    400,
    "The instance must have at least one administrator.",
  ],
  INSTANCE_ADMIN_REQUIRED: [
    403,
    "Only instance administrators can remove users.",
  ],
  CANNOT_REMOVE_YOURSELF: [400, "You cannot remove yourself."],
} as const satisfies Record<string, readonly [number, string]>;

export type AdminErrorCode = keyof typeof ADMIN_ERRORS;

export function adminError(code: AdminErrorCode): ApiError {
  const [status, message] = ADMIN_ERRORS[code];
  return new ApiError(status, { code, message });
}
