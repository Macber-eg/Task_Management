import { describe, expect, it } from "vitest";
import { assertCloudInvitePolicy } from "./assert-cloud-invite-policy";

describe("assertCloudInvitePolicy", () => {
  it("refuses a guest inviter", () => {
    expect(() =>
      assertCloudInvitePolicy({ isAnonymous: true }, "someone@example.com"),
    ).toThrow(
      expect.objectContaining({
        status: 403,
        code: "GUEST_INVITATIONS_NOT_ALLOWED",
      }),
    );
  });

  it("refuses a disposable invitee address", () => {
    expect(() =>
      assertCloudInvitePolicy({ isAnonymous: false }, "x@mailinator.com"),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: "DISPOSABLE_EMAIL_NOT_ALLOWED",
      }),
    );
  });

  it("lets a regular invite through", () => {
    expect(() =>
      assertCloudInvitePolicy({ isAnonymous: null }, "teammate@example.com"),
    ).not.toThrow();
  });
});
