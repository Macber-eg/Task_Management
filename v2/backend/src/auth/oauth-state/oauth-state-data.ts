import { z } from "zod";

/**
 * What a sign-in or link request remembers until the provider sends the
 * browser back. Stored as JSON in `verification.value`, in the shape the
 * previous backend wrote, so a flow started before an upgrade completes.
 * Unknown keys (`additionalData`) are kept.
 */
export const oauthStateDataSchema = z.looseObject({
  callbackURL: z.string(),
  codeVerifier: z.string(),
  errorURL: z.string().optional(),
  newUserURL: z.string().optional(),
  expiresAt: z.number(),
  /** The `state` value sent to the provider. */
  oauthState: z.string().optional(),
  /** Present when a signed-in user is linking another sign-in method. */
  link: z
    .object({ email: z.string(), userId: z.coerce.string() })
    .optional(),
  requestSignUp: z.boolean().optional(),
});

export type OAuthStateData = z.infer<typeof oauthStateDataSchema>;

export type OAuthStateRequest = {
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
  requestSignUp?: boolean;
  additionalData?: Record<string, unknown>;
};
