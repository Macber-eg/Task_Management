import { createHash } from "node:crypto";

/** Keys are stored as the unpadded base64url SHA-256 of the key. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("base64url");
}
