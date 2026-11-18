import { Authenticator } from "../../src/auth/authenticator";
import type { Principal } from "../../src/auth/principal";
import type { SessionEntity } from "../../src/database/entities/session.entity";
import type { UserEntity } from "../../src/database/entities/user.entity";

function sessionFor(userId: string): SessionEntity {
  const now = new Date();
  return {
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
    activeOrganizationId: null,
    activeTeamId: null,
    impersonatedBy: null,
    kind: "browser",
    previousToken: null,
    rotatedAt: null,
  };
}

/**
 * Stands in for real credentials: every request is made by whoever the test
 * last signed in, or by nobody.
 */
export class TestAuthenticator extends Authenticator {
  private current: Principal | null = null;

  /** Requests come from this user's browser session. */
  signIn(user: UserEntity): void {
    this.current = {
      userId: user.id,
      userEmail: user.email,
      user,
      session: sessionFor(user.id),
    };
  }

  /** Requests come from exactly this caller, e.g. one carrying an `apiKey`. */
  signInAs(principal: Principal): void {
    this.current = principal;
  }

  /** Requests carry no valid credentials. */
  signOut(): void {
    this.current = null;
  }

  async authenticate(): Promise<Principal | null> {
    return this.current;
  }
}
