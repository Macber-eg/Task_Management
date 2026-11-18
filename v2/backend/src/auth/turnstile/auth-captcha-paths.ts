/** Auth routes (relative to `/api/auth`) that start a sign-in or sign-up. */
export const authCaptchaPaths: ReadonlySet<string> = new Set([
  "/sign-up/email",
  "/sign-in/social",
  "/sign-in/oauth2",
  "/sign-in/anonymous",
  "/sign-in/magic-link",
  "/request-password-reset",
  "/email-otp/send-verification-otp",
]);
