import { randomBytes } from "node:crypto";

export const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const ALPHANUMERIC = `${LETTERS}0123456789`;

/** `length` characters drawn uniformly from `alphabet` (at most 256 symbols). */
export function randomString(length: number, alphabet: string): string {
  // Bytes past the last whole multiple of the alphabet size are discarded;
  // mapping them too would make the first characters more likely.
  const usable = Math.floor(256 / alphabet.length) * alphabet.length;
  let result = "";
  while (result.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= usable) continue;
      result += alphabet.charAt(byte % alphabet.length);
      if (result.length === length) break;
    }
  }
  return result;
}
