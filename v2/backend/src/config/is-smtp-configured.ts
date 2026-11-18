type SmtpEnv = Record<string, string | undefined>;

/**
 * Whether outgoing mail can be sent at all. This is what the send helpers
 * actually require: a host to connect to and an envelope sender.
 */
export function isSmtpConfigured(env: SmtpEnv = process.env): boolean {
  return Boolean(env.SMTP_HOST) && Boolean(env.SMTP_FROM);
}
