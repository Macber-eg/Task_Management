import { HTTPException } from "../../common/errors/http-exception";

export const DEVICE_MESSAGES = {
  INVALID_DEVICE_CODE: "Invalid device code",
  EXPIRED_DEVICE_CODE: "Device code has expired",
  EXPIRED_USER_CODE: "User code has expired",
  AUTHORIZATION_PENDING: "Authorization pending",
  ACCESS_DENIED: "Access denied",
  INVALID_USER_CODE: "Invalid user code",
  DEVICE_CODE_ALREADY_PROCESSED: "Device code already processed",
  DEVICE_CODE_NOT_CLAIMED:
    "Device code has not been claimed by a verifying session; call `GET /device` with the `user_code` while signed in before approving or denying",
  POLLING_TOO_FREQUENTLY: "Polling too frequently",
  USER_NOT_FOUND: "User not found",
  AUTHENTICATION_REQUIRED: "Authentication required",
} as const;

/**
 * An RFC 8628 error. The device flow answers `{ error, error_description }`
 * instead of the API's usual error body; CLI and MCP clients branch on
 * `error`.
 */
export function deviceError(
  status: number,
  error: string,
  description: string,
): HTTPException {
  return new HTTPException(status, {
    message: description,
    res: new Response(JSON.stringify({ error, error_description: description }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  });
}
