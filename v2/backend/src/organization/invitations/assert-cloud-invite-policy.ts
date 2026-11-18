import { isDisposableEmail } from "../../auth/registration/is-disposable-email";
import { ApiError } from "../../common/errors/api-error";
import type { UserEntity } from "../../database/entities/user.entity";

/**
 * Cloud only: guests and disposable addresses were how throwaway sign-ups
 * sent thousands of phishing invites, so neither may take part.
 */
export function assertCloudInvitePolicy(
  inviter: Pick<UserEntity, "isAnonymous">,
  inviteeEmail: string,
): void {
  if (inviter.isAnonymous) {
    throw new ApiError(403, {
      code: "GUEST_INVITATIONS_NOT_ALLOWED",
      message: "Guest accounts may not send workspace invitations.",
    });
  }
  if (inviteeEmail && isDisposableEmail(inviteeEmail)) {
    throw new ApiError(400, {
      code: "DISPOSABLE_EMAIL_NOT_ALLOWED",
      message: "Invitations to disposable-email addresses are not allowed.",
    });
  }
}
