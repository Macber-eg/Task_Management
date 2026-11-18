import { randomBytes } from "node:crypto";
import { ALPHANUMERIC, randomString } from "../api-key/random-string";

// No 0/O or 1/I: the user types this code from another screen.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_CODE_LENGTH = 40;
const USER_CODE_LENGTH = 8;

/** The secret the polling client holds. */
export function generateDeviceCode(): string {
  return randomString(DEVICE_CODE_LENGTH, ALPHANUMERIC);
}

/** What the person enters in the browser; 32 symbols, so bytes map evenly. */
export function generateUserCode(): string {
  return Array.from(randomBytes(USER_CODE_LENGTH))
    .map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length])
    .join("");
}

/** User codes may be typed with the dash the web app displays. */
export function normalizeUserCode(userCode: string): string {
  return userCode.replace(/-/g, "");
}
