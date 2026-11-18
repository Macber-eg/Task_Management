import type { EntityManager } from "typeorm";
import { ApiError } from "../../common/errors/api-error";
import { isCloud } from "../../config/is-cloud";
import { authError } from "../auth-error";
import { checkRegistrationAllowed } from "./check-registration-allowed";
import { isDisposableEmail } from "./is-disposable-email";
import { normalizeInvitationId } from "./registration-policy";

/**
 * The checks the previous API ran before an email sign-up was even parsed.
 * The first account sets the instance up and skips all of them.
 * `invitationEmail` is the address an invitation is matched against; it may
 * come from a header rather than the body.
 */
export async function assertEmailSignUpAllowed(
  manager: EntityManager,
  signUp: {
    isInstanceAdminSetup: boolean;
    email: string;
    invitationEmail?: string;
    invitationId?: unknown;
  },
): Promise<void> {
  if (signUp.isInstanceAdminSetup) return;

  if (process.env.DISABLE_PASSWORD_REGISTRATION === "true") {
    throw authError("PASSWORD_REGISTRATION_DISABLED");
  }

  if (isCloud() && signUp.email && isDisposableEmail(signUp.email)) {
    throw authError("DISPOSABLE_EMAIL_NOT_ALLOWED");
  }

  if (process.env.DISABLE_REGISTRATION !== "true") return;

  const result = await checkRegistrationAllowed(
    manager,
    signUp.invitationEmail,
    normalizeInvitationId(signUp.invitationId),
  );
  if (!result.allowed) {
    throw new ApiError(403, {
      code: "REGISTRATION_NOT_ALLOWED",
      message: result.reason,
    });
  }
}
