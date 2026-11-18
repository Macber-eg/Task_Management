import { describe, expect, it } from "vitest";
import { resolveLoginMethod } from "./last-login-method";

describe("resolveLoginMethod", () => {
  it.each([
    ["/sign-in/email", "email"],
    ["/sign-up/email", "email"],
    ["/callback/github", "github"],
    ["/oauth2/callback/custom", "custom"],
    ["/magic-link/verify", "magic-link"],
  ])("records %s as %s", (path, method) => {
    expect(resolveLoginMethod(path)).toBe(method);
  });

  it.each(["/sign-in/email-otp", "/sign-in/anonymous", "/get-session"])(
    "records nothing for %s, as the previous backend did",
    (path) => {
      expect(resolveLoginMethod(path)).toBeNull();
    },
  );
});
