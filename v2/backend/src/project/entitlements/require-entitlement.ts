import type { AccessRule } from "../../access/access-rule";
import { RequireEntitlementHandler } from "./require-entitlement.handler";

/** Must follow a workspace access rule, which resolves the workspace. */
export const requireEntitlement: AccessRule<null> = {
  handler: RequireEntitlementHandler,
  options: null,
};
