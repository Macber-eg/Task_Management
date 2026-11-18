import type { EntityManager } from "typeorm";
import { hasRegisteredUsers } from "../../instance/has-registered-users";
import { canSendSignInEmail } from "../registration/can-send-sign-in-email";
import { userExistsByEmail } from "../registration/user-exists-by-email";

/**
 * Whether a sign-in code or link is worth emailing: not to an address that
 * could neither sign in nor register. Reads the flags at call time.
 */
export async function shouldDeliverSignInEmail(
  manager: EntityManager,
  email: string,
): Promise<boolean> {
  if (process.env.DISABLE_PASSWORD_REGISTRATION === "true") {
    return userExistsByEmail(manager, email);
  }
  if (process.env.DISABLE_REGISTRATION === "true") {
    // As in the registration policy, the first real account can always
    // finish setting the instance up.
    if (!(await hasRegisteredUsers(manager))) return true;
    return canSendSignInEmail(manager, email);
  }
  return true;
}
