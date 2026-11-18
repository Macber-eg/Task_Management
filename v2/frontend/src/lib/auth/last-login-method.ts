// Readable cookie the server sets after a successful sign-in, naming the
// method used so the sign-in page can mark it ("google", "email", ...).
const COOKIE_NAME = "better-auth.last_used_login_method";

export function readLastLoginMethod(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(value.join("="));
  }
  return null;
}
