import type { EntityManager } from "typeorm";
import { ApiError } from "../../common/errors/api-error";
import { hasRegisteredUsers } from "../../instance/has-registered-users";
import { checkRegistrationAllowed } from "./check-registration-allowed";

export function normalizeInvitationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[a-z0-9_-]{1,128}$/i.test(normalized) ? normalized : undefined;
}

export function isOAuthCallbackPath(path: unknown): boolean {
  return (
    typeof path === "string" &&
    (path.startsWith("/callback/") || path.startsWith("/oauth2/callback/"))
  );
}

export async function assertGuestRegistrationAllowed(
  manager: EntityManager,
): Promise<void> {
  if (
    process.env.DISABLE_GUEST_ACCESS === "true" ||
    process.env.DISABLE_REGISTRATION === "true" ||
    process.env.DISABLE_PASSWORD_REGISTRATION === "true" ||
    process.env.DISABLE_LOGIN_FORM === "true" ||
    !(await hasRegisteredUsers(manager))
  ) {
    throw new ApiError(403, {
      code: "GUEST_ACCESS_DISABLED",
      message: "Guest access is unavailable on this instance.",
    });
  }
}

/**
 * Decides whether a new account may be created. `context.path` is the auth
 * route creating it, relative to `/api/auth`: only OAuth callbacks, email OTP
 * and magic links prove the address, so only they may match an invitation by
 * email alone.
 */
export async function assertUserRegistrationAllowed(
  manager: EntityManager,
  user: {
    email: string;
    emailVerified?: boolean;
    isAnonymous?: boolean | null;
  },
  context?: { path?: string; invitationId?: unknown },
): Promise<void> {
  if (user.isAnonymous) {
    await assertGuestRegistrationAllowed(manager);
    return;
  }
  // The first account sets the instance up, whatever the flags say.
  if (!(await hasRegisteredUsers(manager))) return;
  if (
    process.env.DISABLE_PASSWORD_REGISTRATION === "true" &&
    !isOAuthCallbackPath(context?.path)
  ) {
    throw new ApiError(403, {
      code: "LOCAL_REGISTRATION_DISABLED",
      message:
        "Local account registration is disabled. Please use a configured social or OIDC sign-in method.",
    });
  }
  const verifiedEmailFlow =
    isOAuthCallbackPath(context?.path) ||
    context?.path === "/sign-in/email-otp" ||
    context?.path === "/magic-link/verify";
  const result = await checkRegistrationAllowed(
    manager,
    user.email,
    normalizeInvitationId(context?.invitationId),
    {
      allowInvitationByEmail: verifiedEmailFlow,
      emailVerified: user.emailVerified === true,
    },
  );
  if (!result.allowed)
    throw new ApiError(403, {
      code: "REGISTRATION_NOT_ALLOWED",
      message: result.reason,
    });
}
