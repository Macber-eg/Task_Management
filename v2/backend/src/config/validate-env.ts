import { z } from "zod";
import { resolveDatabaseConfig } from "../database/resolve-database-url";
import { resolveAuthSecret } from "./auth-secret";

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || URL.canParse(value), "must be a valid URL");

// Only values the process cannot start without are checked here. Feature
// modules read their own variables at call time, as the previous API did, so
// an unconfigured optional feature (SMTP, S3, OAuth) never blocks startup.
const envSchema = z.object({
  PORT: z
    .string()
    .optional()
    .refine(
      (value) => !value || /^\d+$/.test(value),
      "must be a positive integer",
    ),
  KANEO_API_URL: optionalUrl,
  KANEO_CLIENT_URL: optionalUrl,
});

export function validateEnv(): void {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  resolveAuthSecret();
  resolveDatabaseConfig();
}
