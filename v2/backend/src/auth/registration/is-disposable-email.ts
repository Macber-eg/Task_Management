import { DISPOSABLE_EMAIL_DOMAINS } from "./disposable-email-domains";

const DOMAIN_SET = new Set(
  DISPOSABLE_EMAIL_DOMAINS.map((domain) => domain.toLowerCase()),
);

/** Matches the host itself or any parent domain: `dwv.dropmail.me` and `dropmail.me`. */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return false;
  const host = email
    .slice(at + 1)
    .toLowerCase()
    .trim();
  if (!host) return false;

  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (DOMAIN_SET.has(parts.slice(i).join("."))) return true;
  }
  return false;
}
