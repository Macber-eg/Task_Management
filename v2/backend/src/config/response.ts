import { z } from "../common/openapi";

export const configSchema = z
  .object({
    isCloud: z.boolean(),
    disableRegistration: z.boolean(),
    disablePasswordRegistration: z.boolean(),
    disableEmailOtpSignIn: z.boolean(),
    disableWorkspaceCreation: z.boolean(),
    isDemoMode: z.boolean(),
    hasSmtp: z.boolean(),
    hasGithubSignIn: z.boolean(),
    hasGoogleSignIn: z.boolean(),
    hasDiscordSignIn: z.boolean(),
    hasCustomOAuth: z.boolean(),
    hasGuestAccess: z.boolean(),
    disableLoginForm: z.boolean(),
    customOAuthAutoLogin: z.boolean(),
    customOAuthLogoutUrl: z.string().nullable(),
    billingEnabled: z.boolean(),
    turnstileSiteKey: z.string().nullable().openapi({
      description:
        "Public Cloudflare Turnstile site key, or null when the captcha is not configured.",
    }),
    sentryDsn: z.string().nullable().openapi({
      description: "Sentry DSN the web app reports errors to, or null.",
    }),
    sentryEnvironment: z.string().nullable().openapi({
      description: "Environment name the web app tags Sentry events with.",
    }),
    analytics: z
      .object({
        plausibleDomain: z.string(),
        scriptUrl: z.string(),
      })
      .nullable()
      .openapi({
        description:
          "Plausible analytics settings, or null unless both the domain and the script URL are configured.",
      }),
  })
  .openapi("Config");
