import type { SessionEntity } from "../../database/entities/session.entity";
import type { UserEntity } from "../../database/entities/user.entity";

/** The user as auth endpoints return it. Clients read these exact keys. */
export function userOutput(user: UserEntity) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    locale: user.locale,
    isAnonymous: user.isAnonymous,
    role: user.role,
    banned: user.banned,
    banReason: user.banReason,
    banExpires: user.banExpires,
  };
}

/**
 * The session as auth endpoints return it. `token` is the access token the
 * caller may use as a Bearer credential; the refresh token and the stored
 * hash are never returned.
 */
export function sessionOutput(session: SessionEntity, token: string) {
  return {
    id: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    token,
    activeOrganizationId: session.activeOrganizationId,
    activeTeamId: session.activeTeamId,
    impersonatedBy: session.impersonatedBy,
  };
}
