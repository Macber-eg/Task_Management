/** A log-safe form of a Discord webhook URL: the token is reduced to its ends. */
export function redactDiscordWebhookUrl(value: string): string {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts.at(-1) ?? "";
    const maskedToken =
      token.length > 6 ? `${token.slice(0, 2)}…${token.slice(-4)}` : "redacted";
    return `${url.origin}/${parts.slice(0, -1).join("/")}/${maskedToken}`;
  } catch {
    return "redacted";
  }
}
