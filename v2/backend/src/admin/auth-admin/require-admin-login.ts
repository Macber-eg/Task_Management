import { authError } from "../../auth/auth-error";
import type { Principal } from "../../auth/principal";
import type { SessionEntity } from "../../database/entities/session.entity";
import type { UserEntity } from "../../database/entities/user.entity";

export type AdminCaller = { user: UserEntity; session: SessionEntity };

/** The admin endpoints act for a signed-in person, never for an API key. */
export function requireAdminLogin(principal: Principal): AdminCaller {
  if (!principal.user || !principal.session) throw authError("UNAUTHORIZED");
  return { user: principal.user, session: principal.session };
}
