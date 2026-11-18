import {
  applyDecorators,
  SetMetadata,
  type Type,
  UseGuards,
} from "@nestjs/common";
import type { ApiRequest } from "../auth/principal";
import { AccessGuard } from "./access.guard";
import { ACCESS_RULES_KEY } from "./access-rules-key";

/** Checks one access rule; throws to refuse the request. */
export interface AccessRuleHandler<Options = unknown> {
  check(request: ApiRequest, options: Options): Promise<void>;
}

/** A rule is data: which injectable handler runs it, and with what options. */
export type AccessRule<Options = unknown> = {
  handler: Type<AccessRuleHandler<Options>>;
  options: Options;
};

/**
 * A rule whatever its options type. `AccessRule<never>` cannot stand in for
 * this: no rule's `options` is assignable to `never`.
 */
type AnyAccessRule = {
  handler: Type<AccessRuleHandler<never>>;
  options: unknown;
};

/**
 * Declares a route's authorization, checked in the order given. Typically a
 * workspace rule first (it resolves and verifies the workspace), then the
 * permission the action needs:
 *
 *   @Access(workspaceAccess.fromLabel(), requireWorkspacePermission({ label: ["update"] }))
 */
export function Access(...rules: AnyAccessRule[]) {
  return applyDecorators(
    SetMetadata(ACCESS_RULES_KEY, rules),
    UseGuards(AccessGuard),
  );
}
