import type { AccessRule } from "../../access/access-rule";
import { ScopeToProjectFromBodyHandler } from "./scope-to-project-from-body.handler";

/**
 * `@Access(scopeToProjectFromBody(), requireWorkspacePermission(...))`: the
 * previous API's `scopeToProjectFromBody` middleware.
 */
export function scopeToProjectFromBody(): AccessRule<void> {
  return { handler: ScopeToProjectFromBodyHandler, options: undefined };
}
