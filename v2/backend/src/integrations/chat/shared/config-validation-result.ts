import { ConfigValidationError } from "./config-schema";

export type ConfigValidationResult = { valid: boolean; errors?: string[] };

/** Turns a failed parse (or a destination check) into the validator result. */
export function invalidConfig(error: unknown): ConfigValidationResult {
  if (error instanceof ConfigValidationError) {
    return { valid: false, errors: error.issues };
  }
  return {
    valid: false,
    errors: [error instanceof Error ? error.message : "Invalid config"],
  };
}
