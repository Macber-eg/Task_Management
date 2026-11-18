import { createHash } from "node:crypto";

/** PKCE S256: the challenge is the base64url SHA-256 of the verifier. */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash("sha256").update(codeVerifier).digest();
  return hash.toString("base64url") === codeChallenge;
}
