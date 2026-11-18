import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { UserEntity } from "../../database/entities/user.entity";

// Routes after which a browser that held a guest session has signed in as
// someone else (relative to `/api/auth`).
const LINKING_PATH_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/callback",
  "/oauth2/callback",
  "/magic-link/verify",
  "/email-otp/verify-email",
  "/one-tap/callback",
  "/passkey/verify-authentication",
  "/phone-number/verify",
  "/verify-email",
];

type SignedInUser = Pick<UserEntity, "id" | "isAnonymous">;

/**
 * A guest who signs in or up for real in the same browser leaves the guest
 * account behind; it is deleted (its sessions and accounts cascade) once the
 * new session exists. Its sockets are left alone: the new login in that
 * browser must keep working.
 */
@Injectable()
export class GuestAccountLinking {
  private readonly logger = new Logger(GuestAccountLinking.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Whether a sign-in on this route can retire a guest account. */
  appliesTo(path: string): boolean {
    // With guest access switched off the guest plugin was never loaded.
    return (
      process.env.DISABLE_GUEST_ACCESS !== "true" &&
      LINKING_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
    );
  }

  async afterSignIn(
    path: string,
    previous: SignedInUser | null,
    signedIn: SignedInUser,
  ): Promise<void> {
    if (!this.appliesTo(path) || !previous?.isAnonymous) return;
    if (previous.id === signedIn.id || signedIn.isAnonymous) return;

    try {
      await this.dataSource.manager.delete(UserEntity, { id: previous.id });
    } catch {
      this.logger.error(
        "Failed to clean up anonymous user during post-link cleanup",
      );
    }
  }
}
