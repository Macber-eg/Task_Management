import { resolveFileSecret } from "./file-secret";
import { isGithubSsoConfigured } from "./github-sso-env";
import { isBillingEnabled } from "./is-billing-enabled";
import { isCloud } from "./is-cloud";
import { isSmtpConfigured } from "./is-smtp-configured";

function analyticsSettings() {
  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN;
  const scriptUrl = process.env.PLAUSIBLE_SCRIPT_URL;
  return plausibleDomain && scriptUrl ? { plausibleDomain, scriptUrl } : null;
}

/**
 * The public instance settings, read from the environment on every call.
 * The login screen fetches them unauthenticated, so nothing here may be a
 * secret.
 */
export function getSettings() {
  return {
    isCloud: isCloud(),
    disableRegistration: process.env.DISABLE_REGISTRATION === "true",
    disablePasswordRegistration:
      process.env.DISABLE_PASSWORD_REGISTRATION === "true",
    disableEmailOtpSignIn: process.env.DISABLE_EMAIL_OTP_SIGN_IN === "true",
    disableWorkspaceCreation: process.env.DISABLE_WORKSPACE_CREATION === "true",
    isDemoMode: process.env.DEMO_MODE === "true",
    hasSmtp: isSmtpConfigured(),
    hasGithubSignIn: isGithubSsoConfigured(),
    hasGoogleSignIn:
      Boolean(process.env.GOOGLE_CLIENT_ID) &&
      Boolean(process.env.GOOGLE_CLIENT_SECRET),
    hasDiscordSignIn:
      Boolean(process.env.DISCORD_CLIENT_ID) &&
      Boolean(process.env.DISCORD_CLIENT_SECRET),
    hasCustomOAuth:
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_ID) &&
      Boolean(resolveFileSecret("CUSTOM_OAUTH_CLIENT_SECRET")),
    hasGuestAccess: [
      "DISABLE_GUEST_ACCESS",
      "DISABLE_REGISTRATION",
      "DISABLE_PASSWORD_REGISTRATION",
      "DISABLE_LOGIN_FORM",
    ].every((key) => process.env[key] !== "true"),
    disableLoginForm: process.env.DISABLE_LOGIN_FORM === "true",
    customOAuthAutoLogin: process.env.CUSTOM_OAUTH_AUTO_LOGIN === "true",
    customOAuthLogoutUrl: process.env.CUSTOM_OAUTH_LOGOUT_URL || null,
    billingEnabled: isBillingEnabled(),
    turnstileSiteKey:
      process.env.TURNSTILE_SITE_KEY ||
      process.env.KANEO_TURNSTILE_SITE_KEY ||
      null,
    sentryDsn: process.env.SENTRY_WEB_DSN || null,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT || null,
    analytics: analyticsSettings(),
  };
}
