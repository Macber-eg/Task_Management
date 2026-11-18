import type { EntityManager } from "typeorm";
import { getUserPendingInvitations } from "./get-user-pending-invitations";
import { userExistsByEmail } from "./user-exists-by-email";

/** Sign-in emails only go to existing accounts and invited addresses. */
export async function canSendSignInEmail(
  manager: EntityManager,
  email: string,
): Promise<boolean> {
  if (await userExistsByEmail(manager, email)) {
    return true;
  }
  return (await getUserPendingInvitations(manager, email)).length > 0;
}
