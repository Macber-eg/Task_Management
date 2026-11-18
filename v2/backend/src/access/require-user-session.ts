import type { AccessRule } from "./access-rule";
import { UserSessionHandler } from "./user-session.handler";

export function requireUserSession(): AccessRule<void> {
  return { handler: UserSessionHandler, options: undefined };
}
