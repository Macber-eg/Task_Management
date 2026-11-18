import type { AccessRule } from "./access-rule";
import { InstanceAdminHandler } from "./instance-admin.handler";

export function requireInstanceAdmin(): AccessRule<void> {
  return { handler: InstanceAdminHandler, options: undefined };
}
