import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secrets";

// Encrypted by the previous backend's `encryptSecret` with the key below.
const LEGACY_CIPHERTEXT =
  "enc:v1:L3VbgECMHhjDFsJ6.K21F68fK3t-VMsCVjJjMLA.fTof1eZ_KlxjhGWZSBG07xFAUQ";

describe("notification secrets", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("decrypts a value the previous backend stored", () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "legacy-backend-key");
    expect(decryptSecret(LEGACY_CIPHERTEXT)).toBe("gotify-legacy-token");
  });

  it("round-trips and keeps an already encrypted value unchanged", () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "legacy-backend-key");
    const encrypted = encryptSecret("token");
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(encrypted).not.toContain("token");
    expect(decryptSecret(encrypted)).toBe("token");
    expect(encryptSecret(LEGACY_CIPHERTEXT)).toBe(LEGACY_CIPHERTEXT);
  });

  it("passes plaintext and empty values through", () => {
    expect(decryptSecret("plain")).toBe("plain");
    expect(decryptSecret(null)).toBeNull();
    expect(encryptSecret(undefined)).toBeUndefined();
  });

  it("answers 500 without a key or with the wrong key", () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "");
    expect(() => encryptSecret("token")).toThrow(
      expect.objectContaining({ status: 500 }),
    );
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "another-key");
    expect(() => decryptSecret(LEGACY_CIPHERTEXT)).toThrow(
      expect.objectContaining({
        status: 500,
        message: "Failed to decrypt notification secret",
      }),
    );
    expect(() => decryptSecret("enc:v1:broken")).toThrow(
      expect.objectContaining({
        message: "Invalid encrypted notification secret payload",
      }),
    );
  });
});
