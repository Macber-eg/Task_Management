import { describe, expect, it } from "vitest";
import { isSmtpConfigured } from "./is-smtp-configured";

describe("isSmtpConfigured", () => {
  it("is true for a relay that needs no credentials", () => {
    expect(
      isSmtpConfigured({
        SMTP_HOST: "relay.internal",
        SMTP_FROM: "kaneo@example.com",
      }),
    ).toBe(true);
  });

  it("is false without a host or a sender", () => {
    expect(isSmtpConfigured({ SMTP_FROM: "kaneo@example.com" })).toBe(false);
    expect(isSmtpConfigured({ SMTP_HOST: "relay.internal" })).toBe(false);
    expect(isSmtpConfigured({})).toBe(false);
  });
});
