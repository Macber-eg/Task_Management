import { type ConfigSchema, stringify } from "../chat/shared/config-schema";
import { syncRulesSchema } from "../sync/rules";

/**
 * The optional `syncRules` entry of a Gitea/GitLab config, as the previous
 * backend's valibot `custom` check (same "Invalid input" wording).
 */
export function syncRulesConfig(): ConfigSchema {
  return {
    kind: "schema",
    optional: true,
    run(value) {
      if (value === undefined || syncRulesSchema.safeParse(value).success)
        return { value, typed: true };
      return {
        value,
        typed: false,
        issues: [`Invalid input: Received ${stringify(value)}`],
      };
    },
  };
}

/** valibot's `nonEmpty()` for strings. */
export const nonEmptyMessage = "Invalid length: Expected !0 but received 0";
