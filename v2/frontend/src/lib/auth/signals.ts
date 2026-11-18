// Which cached auth state each successful auth call invalidates. Mirrors the
// listeners the better-auth client and its organization/anonymous/email-OTP
// plugins registered, so screens refresh after the same calls as before.

export type AuthSignal =
  | "$sessionSignal"
  | "$listOrg"
  | "$activeOrgSignal"
  | "$activeMemberSignal"
  | "$activeMemberRoleSignal";

const SESSION_PATHS = new Set([
  "/sign-out",
  "/update-user",
  "/update-session",
  "/sign-up/email",
  "/sign-in/email",
  "/delete-user",
  "/verify-email",
  "/revoke-sessions",
  "/revoke-session",
  "/revoke-other-sessions",
  "/change-email",
  "/change-password",
  "/sign-in/anonymous",
  "/email-otp/verify-email",
  "/sign-in/email-otp",
  "/email-otp/request-email-change",
  "/organization/create",
  "/organization/delete",
  "/organization/remove-member",
  "/organization/leave",
  "/organization/accept-invitation",
]);

const LIST_ORG_PATHS = new Set([
  "/organization/create",
  "/organization/delete",
  "/organization/update",
]);

export function signalsForPath(path: string): AuthSignal[] {
  const signals: AuthSignal[] = [];
  if (SESSION_PATHS.has(path) || path.startsWith("/organization/set-active")) {
    signals.push("$sessionSignal");
  }
  if (LIST_ORG_PATHS.has(path)) signals.push("$listOrg");
  if (path === "/sign-out" || path.startsWith("/organization")) {
    signals.push("$activeOrgSignal");
  }
  if (
    path.includes("/organization/update-member-role") ||
    path.startsWith("/organization/set-active")
  ) {
    signals.push("$activeMemberSignal", "$activeMemberRoleSignal");
  }
  return signals;
}

/** Calls whose result other tabs must see (they refetch their session). */
export function broadcastTrigger(path: string): string | null {
  if (path === "/sign-out") return "signout";
  if (path === "/update-user" || path === "/update-session") {
    return "updateUser";
  }
  if (path.startsWith("/sign-in/") || path.startsWith("/sign-up/")) {
    return "signin";
  }
  return null;
}
