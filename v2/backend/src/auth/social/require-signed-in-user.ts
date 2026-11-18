import type { UserEntity } from "../../database/entities/user.entity";
import { authError } from "../auth-error";
import type { Principal } from "../principal";

/**
 * The person behind a login session. API keys are refused: linking a sign-in
 * method acts on the account itself, which a key must not be able to do.
 */
export function requireSignedInUser(principal: Principal | null): UserEntity {
  if (!principal?.user || !principal.session || principal.apiKey) {
    throw authError("UNAUTHORIZED");
  }
  return principal.user;
}
